import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

const dir = mkdtempSync(join(tmpdir(), "subagent-lease-"));
process.env.PI_CODING_AGENT_DIR = join(dir, "agent");
const { startRpcSession } = await import("../dist/runtime/session-runtime.js");
const { createSubagentController } = await import("../dist/runtime/subagents.js");
const { acquireSessionLock } = await import("../dist/runtime/session-lock.js");

test("subagent model validation failure releases the lease acquired before initialization", async (t) => {
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const { session: parent } = await startRpcSession("parent", "", dir, { toolNames: [] });
  t.after(() => parent.shutdown());
  let allocated;
  let released = false;
  const locks = join(dir, "agent", "locks", "sessions");
  const controller = createSubagentController({
    getSession: () => parent,
    isBuiltInSubagentsEnabled: () => true,
    acquireSessionLease(file) {
      allocated = file;
      const lease = acquireSessionLock(file, locks, "rpc-child");
      assert.throws(() => acquireSessionLock(file, locks, "cli"), { code: "session_locked" });
      return () => { released = true; lease.release(); };
    },
    registerSession: () => { throw new Error("must fail before registration"); },
    reopenSession: async () => parent,
    resolveSessionPath: async () => null,
    invalidateSessionList() {},
  });
  await assert.rejects(controller.extensionRuntime.start({
    parentContext: { sessionManager: { getSessionId: () => parent.sessionId } },
    parentToolCallId: "call", profile: "explore", model: "missing-provider/missing-model",
    task: "never execute", description: "lease check",
  }), /model/i);
  assert.ok(allocated);
  assert.equal(released, true);
  acquireSessionLock(allocated, locks, "cli").release();
});
