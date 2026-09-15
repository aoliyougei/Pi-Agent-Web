import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const route = new URL("./[id]/route.ts", import.meta.url);

test("public subagent control route is a remote-only thin wrapper", async () => {
  const source = await readFile(route, "utf8");
  assert.match(source, /agent-rpc\/routes\/subagents-instance/);
  assert.doesNotMatch(source, /rpc-manager|subagent-runtime|session-runtime|@earendil-works\/pi-|from\s+["'](?:node:)?(?:fs|path|os|child_process)["']/);
});
