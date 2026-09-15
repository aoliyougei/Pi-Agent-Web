import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const routes = [
  new URL("./[id]/remote-files/route.ts", import.meta.url),
  new URL("./[id]/remote-file/route.ts", import.meta.url),
  new URL("../sessions/[id]/ssh-environment/route.ts", import.meta.url),
];

test("public SSH handlers are remote-only thin wrappers", async () => {
  for (const route of routes) {
    const source = await readFile(route, "utf8");
    assert.match(source, /agent-rpc\/routes\/ssh-instance/);
    assert.doesNotMatch(source, /rpc-manager|SessionManager|remote-tool-bridge|remote-path-security|ssh-environment|@earendil-works\/pi-|from\s+["'](?:node:)?(?:fs|path|os|child_process)["']/);
  }
});
