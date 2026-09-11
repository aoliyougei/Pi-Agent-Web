import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { AgentSessionRuntime, SessionManager } from "@earendil-works/pi-coding-agent";
import { acquireSessionLock } from "../dist/runtime/session-lock.js";
import { installSessionManagerLocks } from "../dist/runtime/session-manager-lock.js";

async function fixture(t, fail = false) {
  const { installSessionRuntimeLocks } = await import("../dist/runtime/session-runtime-lock.js");
  const dir = mkdtempSync(join(tmpdir(), "pi-runtime-lock-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const locks = join(dir, "locks");
  const guard = installSessionManagerLocks(SessionManager, { directory: locks, owner: "cli", piVersion: "0.84.4" });
  t.after(() => guard.uninstall());
  t.after(installSessionRuntimeLocks(guard));
  const manager = SessionManager.create(dir, dir);
  const target = join(dir, "target.jsonl");
  writeFileSync(target, JSON.stringify({ type: "session", version: 3, id: "target", timestamp: new Date().toISOString(), cwd: dir }) + "\n");
  const shutdown = [];
  const session = (manager) => ({
    sessionManager: manager, sessionFile: manager.getSessionFile(), abort: async () => {},
    dispose() { shutdown.push(manager); },
    createReplacedSessionContext: () => ({}),
    extensionRunner: {
      hasHandlers: (name) => name === "session_shutdown",
      emit: async () => { assert.throws(() => acquireSessionLock(manager.getSessionFile(), locks, "rpc"), { code: "session_locked" }); },
    },
  });
  const runtime = new AgentSessionRuntime(session(manager), { cwd: dir, agentDir: dir }, async ({ sessionManager }) => {
    if (fail) throw new Error("factory failed");
    return { session: session(sessionManager), services: { cwd: dir, agentDir: dir }, diagnostics: [] };
  });
  return { dir, locks, guard, manager, target, runtime, shutdown };
}

test("successful switch holds locks through shutdown, releases old manager, and dispose releases new", async (t) => {
  const { locks, manager, target, runtime, shutdown } = await fixture(t);
  await runtime.switchSession(target);
  assert.deepEqual(shutdown, [manager]);
  acquireSessionLock(manager.getSessionFile(), locks, "rpc").release();
  assert.throws(() => acquireSessionLock(target, locks, "rpc"), { code: "session_locked" });
  await runtime.dispose();
  acquireSessionLock(target, locks, "rpc").release();
});

test("post-switch callback failure keeps the successfully adopted target locked", async (t) => {
  const { locks, manager, target, runtime } = await fixture(t);
  await assert.rejects(runtime.switchSession(target, { withSession: async () => { throw new Error("callback failed"); } }), /callback failed/);
  assert.equal(runtime.session.sessionManager.getSessionFile(), target);
  acquireSessionLock(manager.getSessionFile(), locks, "rpc").release();
  assert.throws(() => acquireSessionLock(target, locks, "rpc"), { code: "session_locked" });
  await runtime.dispose();
  acquireSessionLock(target, locks, "rpc").release();
});

test("shutdown failure retains the source while cleaning up an unadopted target", async (t) => {
  const { locks, manager, target, runtime, shutdown } = await fixture(t);
  runtime.session.abort = async () => { throw new Error("abort failed"); };
  await assert.rejects(runtime.switchSession(target), /abort failed/);
  assert.deepEqual(shutdown, []);
  acquireSessionLock(target, locks, "rpc").release();
  assert.throws(() => acquireSessionLock(manager.getSessionFile(), locks, "rpc"), { code: "session_locked" });
});

test("dispose failure does not release the current manager", async (t) => {
  const { locks, manager, runtime } = await fixture(t);
  runtime.session.dispose = () => { throw new Error("dispose failed"); };
  await assert.rejects(runtime.dispose(), /dispose failed/);
  assert.throws(() => acquireSessionLock(manager.getSessionFile(), locks, "rpc"), { code: "session_locked" });
});

test("factory failure releases the unadopted target and already disposed source", async (t) => {
  const { locks, manager, target, runtime, shutdown } = await fixture(t, true);
  await assert.rejects(runtime.switchSession(target), /factory failed/);
  assert.deepEqual(shutdown, [manager]);
  acquireSessionLock(manager.getSessionFile(), locks, "rpc").release();
  acquireSessionLock(target, locks, "rpc").release();
});

test("import factory failure releases target after the temporary import lease ends", async (t) => {
  const { installSessionImportLocks } = await import("../dist/runtime/session-import-lock.js");
  const { dir, locks, guard, manager, runtime } = await fixture(t, true);
  t.after(installSessionImportLocks(guard));
  const source = join(dir, "source.jsonl");
  writeFileSync(source, JSON.stringify({ type: "session", version: 3, id: "import", timestamp: new Date().toISOString(), cwd: dir }) + "\n");
  await assert.rejects(runtime.importFromJsonl(source), /factory failed/);
  acquireSessionLock(source, locks, "rpc").release();
  acquireSessionLock(manager.getSessionFile(), locks, "rpc").release();
});

test("new-session failure cleans its allocation without releasing a concurrent runtime manager", async (t) => {
  const { dir, locks, guard, runtime } = await fixture(t);
  let enter;
  const entered = new Promise((resolve) => { enter = resolve; });
  let resume;
  const waiting = new Promise((resolve) => { resume = resolve; });
  let allocated;
  // Factory is an SDK constructor input; delay it to overlap a separate allocation.
  const failing = new AgentSessionRuntime(runtime.session, runtime.services, async ({ sessionManager }) => {
    allocated = sessionManager;
    enter();
    await waiting;
    throw new Error("factory failed");
  });
  const failed = assert.rejects(failing.newSession(), /factory failed/);
  await entered;
  const unrelated = SessionManager.create(dir, dir);
  resume();
  await failed;
  acquireSessionLock(allocated.getSessionFile(), locks, "rpc").release();
  assert.throws(() => acquireSessionLock(unrelated.getSessionFile(), locks, "rpc"), { code: "session_locked" });
  guard.release(unrelated);
});

test("failed target validation releases target while keeping the untouched source locked", async (t) => {
  const { dir, locks, manager, target, runtime, shutdown } = await fixture(t);
  writeFileSync(target, JSON.stringify({ type: "session", version: 3, id: "target", timestamp: new Date().toISOString(), cwd: join(dir, "missing") }) + "\n");
  await assert.rejects(runtime.switchSession(target));
  assert.deepEqual(shutdown, []);
  acquireSessionLock(target, locks, "rpc").release();
  assert.throws(() => acquireSessionLock(manager.getSessionFile(), locks, "rpc"), { code: "session_locked" });
});
