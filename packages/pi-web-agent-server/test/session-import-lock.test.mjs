import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { AgentSessionRuntime, SessionManager } from "@earendil-works/pi-coding-agent";
import { acquireSessionLock } from "../dist/runtime/session-lock.js";
import { installSessionManagerLocks } from "../dist/runtime/session-manager-lock.js";

async function fixture(t, cancelled = false) {
  const { installSessionImportLocks } = await import("../dist/runtime/session-import-lock.js");
  const dir = mkdtempSync(join(tmpdir(), "pi-import-lock-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const locks = join(dir, "locks");
  const sessions = join(dir, "sessions");
  mkdirSync(sessions);
  const source = join(dir, "import.jsonl");
  const target = join(sessions, "import.jsonl");
  const header = JSON.stringify({ type: "session", version: 3, id: "import", timestamp: new Date().toISOString(), cwd: dir }) + "\n";
  writeFileSync(source, header);
  writeFileSync(target, "original target\n");
  const guard = installSessionManagerLocks(SessionManager, { directory: locks, owner: "cli", piVersion: "0.84.4" });
  t.after(() => guard.uninstall());
  const uninstall = installSessionImportLocks(guard);
  t.after(uninstall);
  const makeSession = (sessionManager) => ({ sessionManager, sessionFile: sessionManager.getSessionFile(), abort: async () => {}, dispose() {}, extensionRunner: { hasHandlers: () => cancelled, emit: async () => ({ cancel: true }) } });
  const originalManager = SessionManager.create(dir, sessions);
  const runtime = new AgentSessionRuntime(makeSession(originalManager), { cwd: dir, agentDir: dir }, async ({ sessionManager }) => ({ session: makeSession(sessionManager), services: { cwd: dir, agentDir: dir }, diagnostics: [] }));
  return { dir, locks, source, target, header, guard, runtime, originalManager };
}

test("import refuses a locked target before copy or runtime teardown", async (t) => {
  const { locks, source, target, runtime, originalManager } = await fixture(t);
  const held = acquireSessionLock(target, locks, "rpc");
  t.after(() => held.release());
  await assert.rejects(runtime.importFromJsonl(source), { code: "session_locked" });
  assert.equal(readFileSync(target, "utf8"), "original target\n");
  assert.equal(runtime.session.sessionManager, originalManager);
});

test("cancelled import releases its temporary target lease without copying", async (t) => {
  const { locks, source, target, runtime } = await fixture(t, true);
  assert.deepEqual(await runtime.importFromJsonl(source), { cancelled: true });
  assert.equal(readFileSync(target, "utf8"), "original target\n");
  acquireSessionLock(target, locks, "rpc").release();
});

test("successful import transfers temporary ownership to its new manager", async (t) => {
  const { locks, source, target, header, runtime, guard } = await fixture(t);
  assert.deepEqual(await runtime.importFromJsonl(source), { cancelled: false });
  assert.equal(readFileSync(target, "utf8"), header);
  assert.equal(runtime.session.sessionManager.getSessionFile(), target);
  assert.throws(() => acquireSessionLock(target, locks, "rpc"), { code: "session_locked" });
  guard.release(runtime.session.sessionManager);
  acquireSessionLock(target, locks, "rpc").release();
});

test("an import holds the target across async hooks and rejects a concurrent import", async (t) => {
  const { locks, source, target, runtime } = await fixture(t);
  let enter;
  const entered = new Promise((resolve) => { enter = resolve; });
  let resume;
  const waiting = new Promise((resolve) => { resume = resolve; });
  runtime.session.extensionRunner = { hasHandlers: () => true, emit: async () => { enter(); await waiting; return { cancel: true }; } };
  const first = runtime.importFromJsonl(source);
  await entered;
  try {
    assert.throws(() => acquireSessionLock(target, locks, "rpc"), { code: "session_locked" });
    // The second operation must not reuse the first operation's temporary reference.
    const second = runtime.importFromJsonl(source);
    resume();
    await assert.rejects(second, { code: "session_locked" });
  } finally { resume(); await first; }
  acquireSessionLock(target, locks, "rpc").release();
});

test("missing source releases its temporary lease", async (t) => {
  const { locks, dir, target, runtime } = await fixture(t);
  await assert.rejects(runtime.importFromJsonl(join(dir, "missing", "import.jsonl")), /File not found/);
  assert.equal(readFileSync(target, "utf8"), "original target\n");
  acquireSessionLock(target, locks, "rpc").release();
});
