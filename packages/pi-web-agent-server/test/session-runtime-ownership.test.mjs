import assert from "node:assert/strict";
import test from "node:test";
import { getRpcSessionOwnerships } from "../dist/runtime/session-runtime.js";

test("Runtime ownership snapshot includes idle alive Sessions", () => {
  const previous = globalThis.__piAgentServerSessions;
  const previousStarting = globalThis.__piAgentServerStartingSessionCwds;
  globalThis.__piAgentServerSessions = new Map([
    ["idle", { isAlive: () => true, cwd: "/repo/worktree", sessionFile: "/sessions/idle.jsonl" }],
    ["dead", { isAlive: () => false, cwd: "/repo/worktree", sessionFile: "/sessions/dead.jsonl" }],
  ]);
  globalThis.__piAgentServerStartingSessionCwds = new Map([["/repo/starting", 1]]);
  try {
    assert.deepEqual(getRpcSessionOwnerships(), [
      { cwd: "/repo/worktree", path: "/sessions/idle.jsonl" },
      { cwd: "/repo/starting", path: "" },
    ]);
  } finally {
    globalThis.__piAgentServerSessions = previous;
    globalThis.__piAgentServerStartingSessionCwds = previousStarting;
  }
});
