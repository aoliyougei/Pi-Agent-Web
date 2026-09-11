import assert from "node:assert/strict";
import fs from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { acquireSessionLock } from "../dist/runtime/session-lock.js";
import { installSessionManagerLocks } from "../dist/runtime/session-manager-lock.js";

async function fixture(t) {
  const { installSessionForkLocks } = await import("../dist/runtime/session-fork-lock.js");
  const dir = fs.mkdtempSync(join(tmpdir(), "pi-fork-lock-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const locks = join(dir, "locks");
  const guard = installSessionManagerLocks(SessionManager, { directory: locks, owner: "cli", piVersion: "0.84.4" });
  t.after(() => guard.uninstall());
  t.after(installSessionForkLocks(guard));
  const source = join(dir, "source.jsonl");
  const bytes = JSON.stringify({ type: "session", version: 3, id: "source", timestamp: new Date().toISOString(), cwd: dir }) + "\n";
  fs.writeFileSync(source, bytes);
  const timestamp = "2026-01-01T00:00:00.000Z";
  t.mock.timers.enable({ apis: ["Date"], now: Date.parse(timestamp) });
  const id = "abcdef01-2345-4678-9abc-def012345678";
  const target = join(dir, `${timestamp.replace(/[:.]/g, "-")}_${id}.jsonl`);
  return { dir, locks, guard, source, target, bytes, id };
}

test("fork rejects a locked not-yet-created target before its first write", async (t) => {
  const { dir, locks, source, target, id, bytes } = await fixture(t);
  const held = acquireSessionLock(target, locks, "rpc");
  t.after(() => held.release());
  assert.throws(() => SessionManager.forkFrom(source, dir, dir, { id }), { code: "session_locked" });
  assert.equal(fs.existsSync(target), false);
  assert.equal(fs.readFileSync(source, "utf8"), bytes);
});

test("fork keeps the source locked until copying finishes and transfers the target lease", async (t) => {
  const { dir, locks, guard, source, target, id } = await fixture(t);
  const original = fs.writeFileSync;
  fs.writeFileSync = function (path, ...args) {
    if (path === target) {
      assert.throws(() => acquireSessionLock(source, locks, "rpc"), { code: "session_locked" });
      assert.throws(() => acquireSessionLock(target, locks, "rpc"), { code: "session_locked" });
    }
    return original.call(this, path, ...args);
  };
  syncBuiltinESMExports();
  t.after(() => { fs.writeFileSync = original; syncBuiltinESMExports(); });
  const fork = SessionManager.forkFrom(source, dir, dir, { id });
  assert.equal(fork.getSessionFile(), target);
  assert.equal(fork.getHeader().parentSession, source);
  acquireSessionLock(source, locks, "rpc").release();
  assert.throws(() => acquireSessionLock(target, locks, "rpc"), { code: "session_locked" });
  guard.release(fork);
  acquireSessionLock(target, locks, "rpc").release();
});

test("failed fork restores fs exports and releases temporary leases without deleting existing target", async (t) => {
  const { dir, locks, source, target, id } = await fixture(t);
  fs.writeFileSync(target, "keep me");
  const original = fs.writeFileSync;
  assert.throws(() => SessionManager.forkFrom(source, dir, dir, { id }), { code: "EEXIST" });
  assert.equal(fs.writeFileSync, original);
  assert.equal(fs.readFileSync(target, "utf8"), "keep me");
  acquireSessionLock(source, locks, "rpc").release();
  acquireSessionLock(target, locks, "rpc").release();
});

test("a user-only branch holds its new path before any assistant message is persisted", async (t) => {
  const { dir, locks, guard } = await fixture(t);
  const manager = SessionManager.create(dir, dir);
  const previous = manager.getSessionFile();
  const leaf = manager.appendMessage({ role: "user", content: "hello", timestamp: Date.now() });
  const branch = manager.createBranchedSession(leaf);
  assert.notEqual(branch, previous);
  assert.equal(fs.existsSync(branch), false);
  assert.throws(() => acquireSessionLock(branch, locks, "rpc"), { code: "session_locked" });
  acquireSessionLock(previous, locks, "rpc").release();
  guard.release(manager);
  acquireSessionLock(branch, locks, "rpc").release();
});

test("branch write failure restores source state and releases the failed target lease", async (t) => {
  const { dir, locks, guard } = await fixture(t);
  const manager = SessionManager.create(dir, dir);
  const leaf = manager.appendMessage({ role: "assistant", content: [], api: "test", provider: "test", model: "test", usage: {}, stopReason: "stop", timestamp: Date.now() });
  const source = manager.getSessionFile();
  const entries = manager.getEntries();
  const bytes = fs.readFileSync(source, "utf8");
  const open = fs.openSync;
  let target;
  fs.openSync = function (path, flags, ...args) {
    if (typeof path === "string" && path.endsWith(".jsonl") && path !== source && flags === "w") {
      target = path;
      throw Object.assign(new Error("disk unavailable"), { code: "EIO" });
    }
    return open.call(this, path, flags, ...args);
  };
  syncBuiltinESMExports();
  try { assert.throws(() => manager.createBranchedSession(leaf), { code: "EIO" }); }
  finally { fs.openSync = open; syncBuiltinESMExports(); }
  assert.ok(target);
  assert.equal(manager.getSessionFile(), source);
  assert.deepEqual(manager.getEntries(), entries);
  assert.equal(fs.readFileSync(source, "utf8"), bytes);
  assert.throws(() => acquireSessionLock(source, locks, "rpc"), { code: "session_locked" });
  acquireSessionLock(target, locks, "rpc").release();
  guard.release(manager);
});

test("fork rejects a source held by a separate lease before creating a target", async (t) => {
  const { dir, locks, source, target, id } = await fixture(t);
  const held = acquireSessionLock(source, locks, "rpc");
  t.after(() => held.release());
  assert.throws(() => SessionManager.forkFrom(source, dir, dir, { id }), { code: "session_locked" });
  assert.equal(fs.existsSync(target), false);
});
