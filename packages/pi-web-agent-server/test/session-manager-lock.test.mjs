import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join, relative } from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { acquireSessionLock } from "../dist/runtime/session-lock.js";

const subject = new URL("../dist/runtime/session-manager-lock.js", import.meta.url);

test("guarded SDK open rejects before empty-file initialization and keeps original bytes", async (t) => {
  const { installSessionManagerLocks } = await import(subject);
  const dir = mkdtempSync(join(tmpdir(), "pi-sdk-lock-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const file = join(dir, "empty.jsonl");
  const locks = join(dir, "locks");
  writeFileSync(file, "");
  const held = acquireSessionLock(file, locks, "rpc");
  t.after(() => held.release());
  for (const bytes of ["", JSON.stringify({ type: "session", version: 3, id: "test", timestamp: new Date().toISOString(), cwd: dir }) + "\n"]) {
  writeFileSync(file, bytes);
  for (const input of [file, pathToFileURL(file).href, `~/${relative(homedir(), file)}`]) {
  const child = spawnSync(process.execPath, ["--input-type=module", "-e", `
    import { SessionManager } from '@earendil-works/pi-coding-agent';
    import { installSessionManagerLocks } from ${JSON.stringify(subject.href)};
    installSessionManagerLocks(SessionManager, { directory: process.argv[2], owner: 'cli', piVersion: '0.84.4' });
    for (const open of [() => SessionManager.open(process.argv[1]), () => SessionManager.create(process.cwd()).setSessionFile(process.argv[1])]) {
      try { open(); process.exit(2); }
      catch (error) { if (error.code !== 'session_locked') throw error; }
    }
  `, input, locks], { encoding: "utf8" });
  assert.equal(child.status, 0, child.stderr);
  assert.equal(readFileSync(file, "utf8"), bytes);
  }
  }
  assert.equal(typeof installSessionManagerLocks, "function");
});

test("new, continue and setSessionFile share kernel ownership until each manager is released", async (t) => {
  const { installSessionManagerLocks } = await import(subject);
  const dir = mkdtempSync(join(tmpdir(), "pi-sdk-lock-"));
  const locks = join(dir, "locks");
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const guard = installSessionManagerLocks(SessionManager, { directory: locks, owner: "cli", piVersion: "0.84.4" });
  t.after(() => guard.uninstall());
  const file = join(dir, "existing.jsonl");
  writeFileSync(file, JSON.stringify({ type: "session", version: 3, id: "test", timestamp: new Date().toISOString(), cwd: dir }) + "\n");
  const first = SessionManager.open(file, dir);
  const second = SessionManager.continueRecent(dir, dir);
  assert.equal(second.getSessionFile(), file);
  assert.throws(() => acquireSessionLock(file, locks, "rpc"), { code: "session_locked" });
  guard.release(first);
  assert.throws(() => acquireSessionLock(file, locks, "rpc"), { code: "session_locked" });
  const next = join(dir, "next.jsonl");
  second.setSessionFile(next);
  acquireSessionLock(file, locks, "rpc").release();
  assert.throws(() => acquireSessionLock(next, locks, "rpc"), { code: "session_locked" });
  guard.release(second);
  const created = SessionManager.create(dir, dir);
  assert.throws(() => acquireSessionLock(created.getSessionFile(), locks, "rpc"), { code: "session_locked" });
  guard.release(created);
  acquireSessionLock(created.getSessionFile(), locks, "rpc").release();
});

test("released manager cannot write while a competing owner holds its file", async (t) => {
  const { installSessionManagerLocks } = await import(subject);
  const dir = mkdtempSync(join(tmpdir(), "pi-sdk-lock-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const locks = join(dir, "locks");
  const guard = installSessionManagerLocks(SessionManager, { directory: locks, owner: "cli", piVersion: "0.84.4" });
  t.after(() => guard.uninstall());
  const file = join(dir, "existing.jsonl");
  const bytes = JSON.stringify({ type: "session", version: 3, id: "test", timestamp: new Date().toISOString(), cwd: dir }) + "\n";
  writeFileSync(file, bytes);
  const manager = SessionManager.open(file, dir);
  guard.release(manager);
  const lease = acquireSessionLock(file, locks, "rpc");
  t.after(() => lease.release());
  const entries = manager.getEntries();
  assert.throws(() => manager.appendSessionInfo("changed"), { code: "session_locked" });
  assert.deepEqual(manager.getEntries(), entries);
  assert.equal(readFileSync(file, "utf8"), bytes);
});

test("unsupported SDK versions fail before installing hooks", async () => {
  const { installSessionManagerLocks } = await import(subject);
  assert.throws(() => installSessionManagerLocks(SessionManager, { directory: "/unused", owner: "cli", piVersion: "0.85.0" }), /Unsupported/);
});

test("a malformed target rolls back manager state and releases only the target lease", async (t) => {
  const { installSessionManagerLocks } = await import(subject);
  const dir = mkdtempSync(join(tmpdir(), "pi-sdk-rollback-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const locks = join(dir, "locks");
  const guard = installSessionManagerLocks(SessionManager, { directory: locks, owner: "cli", piVersion: "0.84.4" });
  t.after(() => guard.uninstall());
  const manager = SessionManager.create(dir, dir);
  manager.appendSessionInfo("original");
  const before = { file: manager.getSessionFile(), id: manager.getSessionId(), entries: manager.getEntries() };
  const invalid = join(dir, "invalid.jsonl");
  writeFileSync(invalid, "not a session\n");
  assert.throws(() => manager.setSessionFile(invalid), /not a valid/);
  assert.deepEqual({ file: manager.getSessionFile(), id: manager.getSessionId(), entries: manager.getEntries() }, before);
  assert.throws(() => acquireSessionLock(before.file, locks, "other"), { code: "session_locked" });
  acquireSessionLock(invalid, locks, "other").release();
  assert.equal(readFileSync(invalid, "utf8"), "not a session\n");
});

test("newSession lock conflict restores the previous in-memory branch", async (t) => {
  const { installSessionManagerLocks } = await import(subject);
  const dir = mkdtempSync(join(tmpdir(), "pi-sdk-rollback-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const locks = join(dir, "locks");
  const guard = installSessionManagerLocks(SessionManager, { directory: locks, owner: "cli", piVersion: "0.84.4" });
  t.after(() => guard.uninstall());
  const manager = SessionManager.create(dir, dir);
  manager.appendSessionInfo("original");
  const before = { file: manager.getSessionFile(), id: manager.getSessionId(), entries: manager.getEntries() };
  const timestamp = "2026-01-01T00:00:00.000Z";
  t.mock.timers.enable({ apis: ["Date"], now: Date.parse(timestamp) });
  const id = "abcdef01-2345-4678-9abc-def012345678";
  const target = join(dir, `${timestamp.replace(/[:.]/g, "-")}_${id}.jsonl`);
  const held = acquireSessionLock(target, locks, "rpc");
  t.after(() => held.release());
  assert.throws(() => manager.newSession({ id }), { code: "session_locked" });
  assert.deepEqual({ file: manager.getSessionFile(), id: manager.getSessionId(), entries: manager.getEntries() }, before);
  assert.throws(() => acquireSessionLock(before.file, locks, "other"), { code: "session_locked" });
});

test("a supplied version cannot authorize a foreign manager class", async () => {
  const { installSessionManagerLocks } = await import(subject);
  class ForeignManager extends SessionManager {}
  assert.throws(() => installSessionManagerLocks(ForeignManager, { directory: "/unused", owner: "cli", piVersion: "0.84.4" }), /Unsupported/);
});

test("a failed switch retains the old manager and its lease", async (t) => {
  const { installSessionManagerLocks } = await import(subject);
  const dir = mkdtempSync(join(tmpdir(), "pi-sdk-lock-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const locks = join(dir, "locks");
  const guard = installSessionManagerLocks(SessionManager, { directory: locks, owner: "cli", piVersion: "0.84.4" });
  t.after(() => guard.uninstall());
  const manager = SessionManager.create(dir, dir);
  const original = manager.getSessionFile();
  const target = join(dir, "held.jsonl");
  const lease = acquireSessionLock(target, locks, "rpc");
  t.after(() => lease.release());
  assert.throws(() => manager.setSessionFile(target), { code: "session_locked" });
  assert.equal(manager.getSessionFile(), original);
  assert.throws(() => acquireSessionLock(original, locks, "rpc"), { code: "session_locked" });
  guard.release(manager);
});
