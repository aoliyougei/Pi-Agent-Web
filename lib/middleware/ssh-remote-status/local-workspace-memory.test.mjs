import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const { loadLocalWorkspaces, saveLocalWorkspace, removeLocalWorkspace } = await createJiti(import.meta.url).import("./local-workspace-memory.ts");
const storage = () => {
  const values = new Map();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
  };
};

test("removing a worktree forgets it and descendants without removing sibling directories", () => {
  const value = storage();
  for (const path of ["/repo", "/repo/.worktrees/a", "/repo/.worktrees/a/sub", "/repo/.worktrees/ab"]) saveLocalWorkspace(path, value);
  assert.deepEqual(removeLocalWorkspace("/repo/.worktrees/a", value), ["/repo/.worktrees/ab", "/repo"]);
  assert.deepEqual(loadLocalWorkspaces(value), ["/repo/.worktrees/ab", "/repo"]);
});

test("remembered local workspaces survive without Sessions and dedupe", () => {
  const value = storage();
  assert.deepEqual(saveLocalWorkspace("/app", value), ["/app"]);
  assert.deepEqual(saveLocalWorkspace("/home/node/pi-cwd", value), ["/home/node/pi-cwd", "/app"]);
  assert.deepEqual(saveLocalWorkspace("/app", value), ["/app", "/home/node/pi-cwd"]);
  assert.deepEqual(loadLocalWorkspaces(value), ["/app", "/home/node/pi-cwd"]);
});
