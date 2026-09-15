import assert from "node:assert/strict";
import { createServer } from "node:http";
import test from "node:test";
import { createJiti } from "jiti";
import { createAgentClient } from "../client.ts";

const { createRemoteSshRoutes } = await createJiti(import.meta.url).import("./ssh.ts");
const context = (id) => ({ params: Promise.resolve({ id }) });

test("SSH adapter preserves fixed paths, query, service identity, and response bytes", async (t) => {
  const seen = [];
  const server = createServer(async (request, response) => {
    seen.push({ method: request.method, path: request.url, authorization: request.headers.authorization, cookie: request.headers.cookie });
    response.writeHead(200, { "content-type": "application/json", "set-cookie": "private=1" });
    response.end('{"ok":true}');
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  const routes = createRemoteSshRoutes(createAgentClient({ baseUrl, token: "service-token" }).fetch);
  const request = (url) => new Request(url, { headers: { cookie: "browser-secret=1" } });

  const environment = await routes.ENVIRONMENT(request("http://web/api/sessions/child/ssh-environment?refresh=1"), context("child"));
  const files = await routes.FILES(request("http://web/api/agent/child/remote-files?path=src%2Flib"), context("child"));
  const file = await routes.FILE(request("http://web/api/agent/child/remote-file?path=src%2Fa.ts"), context("child"));

  assert.deepEqual(seen.map(({ method, path }) => [method, path]), [
    ["GET", "/internal/v1/api/sessions/child/ssh-environment?refresh=1"],
    ["GET", "/internal/v1/api/agent/child/remote-files?path=src%2Flib"],
    ["GET", "/internal/v1/api/agent/child/remote-file?path=src%2Fa.ts"],
  ]);
  assert.equal(seen.every(({ authorization }) => authorization === "Bearer service-token"), true);
  assert.equal(seen.every(({ cookie }) => cookie === undefined), true);
  assert.equal(await environment.text(), '{"ok":true}');
  assert.equal(await files.text(), '{"ok":true}');
  assert.equal(await file.text(), '{"ok":true}');
  assert.equal(environment.headers.has("set-cookie"), false);
});

test("SSH adapter rejects malformed session IDs before Agent delivery", async () => {
  let calls = 0;
  const routes = createRemoteSshRoutes(async () => { calls += 1; return Response.json({}); });
  for (const id of ["", "../escape", "a/b", ".hidden"]) {
    assert.equal((await routes.ENVIRONMENT(new Request("http://web/x"), context(id))).status, 400);
    assert.equal((await routes.FILES(new Request("http://web/x"), context(id))).status, 400);
    assert.equal((await routes.FILE(new Request("http://web/x"), context(id))).status, 400);
  }
  assert.equal(calls, 0);
});
