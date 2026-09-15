import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const routes = [
  new URL("./new/route.ts", import.meta.url),
  new URL("./running/route.ts", import.meta.url),
  new URL("./[id]/route.ts", import.meta.url),
  new URL("./[id]/events/route.ts", import.meta.url),
];

test("public Agent handlers are remote-only thin wrappers", async () => {
  for (const route of routes) {
    const source = await readFile(route, "utf8");
    assert.match(source, /agent-rpc\/routes\/agent-instance/);
    assert.doesNotMatch(source, /rpc-manager|session-reader|agent-event-stream|allowFileRoot|@earendil-works\/pi-|from\s+["'](?:node:)?(?:fs|path|os|child_process|crypto)["']/);
  }
});
