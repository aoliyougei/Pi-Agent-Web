import assert from "node:assert/strict";
import test from "node:test";
import { SessionRuntime } from "../dist/runtime/session-runtime.js";

test("shutdown cancels prompts and waits for active commands before releasing its lease", async () => {
  const calls = [];
  let finish;
  const pending = new Promise((resolve) => { finish = resolve; });
  const runtime = new SessionRuntime({
    sessionId: "shutdown", sessionManager: { getCwd: () => "/tmp" }, agent: { state: {} },
    isStreaming: true, isBashRunning: false,
    abort: async () => { calls.push("abort"); },
    compact: async () => { calls.push("compact"); await pending; },
    extensionRunner: { emit: async () => { calls.push("shutdown"); } },
    dispose: () => { calls.push("dispose"); },
  }, { releaseSessionLease: () => { calls.push("release"); } });
  const command = runtime.send({ type: "compact" });
  await new Promise((resolve) => setImmediate(resolve));
  const closing = runtime.shutdown();
  await new Promise((resolve) => setImmediate(resolve));
  assert.ok(calls.includes("abort"));
  assert.equal(calls.includes("release"), false);
  runtime.destroy();
  assert.equal(calls.includes("release"), false);
  await assert.rejects(runtime.send({ type: "set_session_name", name: "late" }), /closing|closed/);
  finish();
  await command;
  await closing;
  assert.deepEqual(calls.slice(-3), ["shutdown", "dispose", "release"]);
});
