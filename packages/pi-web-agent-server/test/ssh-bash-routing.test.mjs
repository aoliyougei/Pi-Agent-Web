import assert from "node:assert/strict";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createJiti } from "jiti";

const { SessionRuntime } = await createJiti(import.meta.url, { interopDefault: true }).import("../src/runtime/session-runtime.ts");
const remote = { type: "custom", customType: "pi-ssh-remote-state", data: { version: 2, target: "devbox", remotePlatform: "unix", remoteShell: "bash", remoteCwd: "/srv/app", remoteHome: "/home/dev" } };
const local = { type: "custom", customType: "pi-ssh-local-state", data: { version: 1 } };
const remoteOperations = {};

function inner(branch, marker, extensionRunner = {}) {
  return {
    sessionId: "ssh-bash-session",
    isBashRunning: false,
    isStreaming: false,
    isCompacting: false,
    extensionRunner,
    sessionManager: {
      getBranch: () => branch,
      getCwd: () => "/local/anchor",
      getSessionFile: () => undefined,
    },
    settingsManager: { getShellPath: () => "/bin/sh" },
    executeBash: async (_command, _onChunk, options) => {
      if (options?.operations === remoteOperations) return { output: "remote operations", exitCode: 0 };
      writeFileSync(marker, "local execution");
      return { output: "local", exitCode: 0 };
    },
    recordBashResult() {},
    abortBash() {},
    dispose() {},
  };
}

function fixture(t) {
  const dir = mkdtempSync(join(tmpdir(), "pi-ssh-bash-"));
  const marker = join(dir, "local-marker");
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return marker;
}

test("saved SSH session without user_bash handler fails closed before local execution", async (t) => {
  const marker = fixture(t);
  const runtime = new SessionRuntime(inner([remote], marker));
  t.after(() => runtime.destroy());

  await assert.rejects(
    runtime.send({ type: "bash", command: `touch ${marker}` }),
    /no SSH user_bash handler is available.*not executed locally/i,
  );
  assert.equal(existsSync(marker), false);
});

test("saved SSH session rejects an unrelated or inactive user_bash handler", async (t) => {
  const marker = fixture(t);
  const runtime = new SessionRuntime(inner([remote], marker, {
    hasHandlers: (name) => name === "user_bash",
    emitUserBash: async () => undefined,
  }));
  t.after(() => runtime.destroy());

  await assert.rejects(
    runtime.send({ type: "bash", command: "must stay remote" }),
    /no SSH user_bash handler is available.*not executed locally/i,
  );
  assert.equal(existsSync(marker), false);
});

test("latest local marker permits local Bash fallback", async (t) => {
  const marker = fixture(t);
  const runtime = new SessionRuntime(inner([remote, local], marker));
  t.after(() => runtime.destroy());

  assert.deepEqual(await runtime.send({ type: "bash", command: "local command" }), { output: "local", exitCode: 0 });
  assert.equal(existsSync(marker), true);
});

test("SSH user_bash operations execute without local fallback", async (t) => {
  const marker = fixture(t);
  const runtime = new SessionRuntime(inner([remote], marker, {
    hasHandlers: (name) => name === "user_bash",
    emitUserBash: async () => ({ operations: remoteOperations }),
  }));
  t.after(() => runtime.destroy());

  assert.deepEqual(await runtime.send({ type: "bash", command: "remote command" }), { output: "remote operations", exitCode: 0 });
  assert.equal(existsSync(marker), false);
});

test("SSH user_bash result is recorded without local execution", async (t) => {
  const marker = fixture(t);
  const recorded = [];
  const value = inner([remote], marker, {
    hasHandlers: (name) => name === "user_bash",
    emitUserBash: async (event) => {
      assert.equal(event.cwd, "/local/anchor");
      return { result: { output: "remote", exitCode: 0 } };
    },
  });
  value.recordBashResult = (...args) => recorded.push(args);
  const runtime = new SessionRuntime(value);
  t.after(() => runtime.destroy());

  assert.deepEqual(await runtime.send({ type: "bash", command: "remote command" }), { output: "remote", exitCode: 0 });
  assert.equal(existsSync(marker), false);
  assert.equal(recorded.length, 1);
});
