import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const routes = [new URL("./config/route.ts", import.meta.url), new URL("./subscribe/route.ts", import.meta.url)];

test("public Push handlers keep browser validation but persist only through Agent RPC", async () => {
  for (const route of routes) {
    const source = await readFile(route, "utf8");
    assert.match(source, /agent-rpc\/routes\/push-instance/);
    assert.doesNotMatch(source, /@\/lib\/web-push|node:fs|from\s+["']fs["']|@earendil-works\/pi-/);
  }
  const subscribe = await readFile(routes[1], "utf8");
  assert.doesNotMatch(subscribe, /hasJsonContentType|request\.clone\(\)\.json\(\)/);
  assert.match(subscribe, /readJsonBody\(request\)/);
  assert.match(subscribe, /MAX_JSON_BYTES/);
  assert.match(subscribe, /headers\.set\("content-type", "application\/json"\)/);
  assert.match(subscribe, /new Request\(request\.url/);
});
