import assert from "node:assert/strict";
import { createServer } from "node:http";
import test from "node:test";
import { createJiti } from "jiti";
import { createAgentClient } from "../client.ts";

const { createRemoteSubagentRoutes } = await createJiti(import.meta.url).import("./subagents.ts");
const context = (id) => ({ params: Promise.resolve({ id }) });

test("subagent adapter preserves fixed path, query, method, raw JSON, and service identity", async (t) => {
  const seen = [];
  const server = createServer(async (request, response) => {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    seen.push({
      method: request.method,
      path: request.url,
      body: Buffer.concat(chunks).toString(),
      type: request.headers["content-type"],
      authorization: request.headers.authorization,
      cookie: request.headers.cookie,
    });
    response.writeHead(200, { "content-type": "application/json", "set-cookie": "secret=1" });
    response.end('{"ok":true}');
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  const routes = createRemoteSubagentRoutes(createAgentClient({ baseUrl, token: "service-token" }).fetch);
  const body = '{ "action": "abort" }\n';

  await (await routes.GET(new Request("http://web/api/subagents/child?view=full"), context("child"))).text();
  await (await routes.POST(new Request("http://web/api/subagents/child", {
    method: "POST",
    headers: { "content-type": "text/plain", cookie: "private=1" },
    body,
  }), context("child"))).text();

  assert.deepEqual(seen.map(({ method, path }) => [method, path]), [
    ["GET", "/internal/v1/api/subagents/child?view=full"],
    ["POST", "/internal/v1/api/subagents/child"],
  ]);
  assert.equal(seen[1].body, body);
  assert.equal(seen[1].type, "application/json");
  assert.equal(seen[1].authorization, "Bearer service-token");
  assert.equal(seen[1].cookie, undefined);
});

test("subagent adapter rejects malformed path parameters before delivery", async () => {
  let calls = 0;
  const routes = createRemoteSubagentRoutes(async () => { calls += 1; return Response.json({}); });
  for (const id of ["", "../escape", "a/b", ".hidden"]) {
    const response = await routes.GET(new Request("http://web/api/subagents/x"), context(id));
    assert.equal(response.status, 400);
  }
  assert.equal(calls, 0);
});
