import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";
const jiti = createJiti(import.meta.url);
const { REQUIRED_CAPABILITIES } = await jiti.import("@aoliyougei/pi-agent-contract");
test("version endpoint reports current backend versions without caching or leaking errors", async () => {
  const { createAgentVersionRoute } = await jiti.import("./version-route.ts");
  const version = { protocolVersion: 1, serverVersion: "0.2.0", piVersion: "1.2.0", piRevision: "revision", capabilities: REQUIRED_CAPABILITIES };
  const route = createAgentVersionRoute(async (path) => { assert.equal(path, "/internal/v1/version"); return Response.json(version); });
  const response = await route();
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.deepEqual(await response.json(), version);
  for (const send of [async () => { throw Error("private-token"); }, async () => new Response(null, { status: 302 }), async () => Response.json({ ...version, piVersion: "9.0.0" })]) {
    const failed = await createAgentVersionRoute(send)();
    assert.equal(failed.status, 503);
    assert.ok(!(await failed.text()).includes("private-token"));
  }
});
