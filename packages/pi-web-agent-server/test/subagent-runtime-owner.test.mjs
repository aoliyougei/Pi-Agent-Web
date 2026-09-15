import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

const root = resolve(new URL("..", import.meta.url).pathname);

test("subagent controller is owned by Agent runtime rather than dependency closure", () => {
  const owner = resolve(root, "src/runtime/subagents.ts");
  assert.equal(existsSync(owner), true);
  assert.equal(existsSync(resolve(root, "src/dependencies/subagent-runtime.ts")), false);
  assert.equal(existsSync(resolve(root, "dist/dependencies/subagent-runtime.js")), false);
  assert.match(readFileSync(owner, "utf8"), /createSubagentController/);
});
