import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createJiti } from "jiti";
const jiti = createJiti(import.meta.url, { alias: { "@": new URL("../../../", import.meta.url).pathname } });
const routes = await jiti.import("./route.ts");
const request = (method, data) => new Request("http://web/api/agent-backends", { method, headers: { "content-type": "application/json" }, body: JSON.stringify(data) });

test("profile API shares redacted configurations and reports invalid or missing profiles", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "backend-api-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  process.env.PI_WEB_CONFIG_DIR = dir;
  const response = await routes.POST(request("POST", { name: "API backend", baseUrl: "https://agent.example:8443", token: "api-test-secret" }));
  assert.equal(response.status, 200);
  const { backend } = await response.json();
  assert.equal(backend.token, undefined);
  const listing = await routes.GET();
  assert.equal(listing.headers.get("cache-control"), "no-store");
  const json = await listing.json();
  assert.equal(json.backends.find((item) => item.id === backend.id).name, "API backend");
  assert.ok(!JSON.stringify(json).includes("api-test-secret"));
  assert.equal((await routes.POST(request("POST", { name: "Bad", baseUrl: "http://host/path", token: "secret" }))).status, 400);
  assert.equal((await routes.DELETE(request("DELETE", { id: backend.id }))).status, 200);
  assert.equal((await routes.DELETE(request("DELETE", { id: backend.id }))).status, 404);
});

test("profile API rejects non-JSON, malformed and oversized bodies", async () => {
  assert.equal((await routes.POST(new Request("http://web/api/agent-backends", { method: "POST", body: "token" }))).status, 400);
  assert.equal((await routes.POST(new Request("http://web/api/agent-backends", { method: "POST", headers: { "content-type": "application/json" }, body: "{" }))).status, 400);
  assert.equal((await routes.POST(request("POST", { token: "x".repeat(20000) }))).status, 400);
});
