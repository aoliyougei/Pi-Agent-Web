import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const { loadLocalWorkspaces, saveLocalWorkspace } = await createJiti(import.meta.url).import("./local-workspace-memory.ts");
const storage = () => {
  const values = new Map();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
  };
};

test("remembered local workspaces survive without Sessions and dedupe", () => {
  const value = storage();
  assert.deepEqual(saveLocalWorkspace("/app", value), ["/app"]);
  assert.deepEqual(saveLocalWorkspace("/home/node/pi-cwd", value), ["/home/node/pi-cwd", "/app"]);
  assert.deepEqual(saveLocalWorkspace("/app", value), ["/app", "/home/node/pi-cwd"]);
  assert.deepEqual(loadLocalWorkspaces(value), ["/app", "/home/node/pi-cwd"]);
});
