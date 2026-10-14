import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { load } from "js-yaml";
const root = new URL("../", import.meta.url);
test("Web starts without a deployment Token and standalone Compose requires only Web", async () => {
  const entry = await readFile(new URL("docker-entrypoint.sh", root), "utf8");
  assert.doesNotMatch(entry, /check-rpc-token/);
  const compose = load(await readFile(new URL("deploy/compose/web-only.yml", root), "utf8"));
  assert.deepEqual(Object.keys(compose.services), ["web"]);
  assert.equal(compose.services.web.depends_on, undefined);
  assert.equal(compose.services.web.secrets, undefined);
  assert.deepEqual(compose.services.web.volumes, ["web-config:/var/lib/pi-agent-web"]);
});
