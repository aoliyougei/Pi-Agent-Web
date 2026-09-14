import assert from "node:assert/strict";
import { createServer } from "node:http";
import test from "node:test";
import { createJiti } from "jiti";
import { createAgentClient } from "../client.ts";

const { createRemoteModelsAuthRoutes } = await createJiti(import.meta.url).import("./models-auth.ts");

test("model/auth adapters preserve routes, raw JSON, and native OAuth streaming", async (t) => {
  const seen = [];
  const server = createServer(async (request, response) => {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    seen.push({ method: request.method, path: request.url, headers: request.headers, body: Buffer.concat(chunks).toString() });
    if (request.url.includes("/auth/login/") && request.method === "GET") {
      response.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache", "set-cookie": "secret=1" });
      response.write('data: {"type":"progress","message":"one"}\n\n');
      setTimeout(() => response.end('data: {"type":"success"}\n\n'), 20);
      return;
    }
    response.writeHead(200, { "content-type": "application/json", "x-request-id": "models-1", "set-cookie": "secret=1" });
    response.end('{"ok":true}');
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  const routes = createRemoteModelsAuthRoutes(createAgentClient({ baseUrl, token: "service-token" }).fetch);
  const context = { params: Promise.resolve({ provider: "dual-provider" }) };
  const body = '{ "apiKey": "browser-secret" }\n';

  await (await routes.MODELS(new Request("http://web/api/models?cwd=%2Ftmp%2Fa%20b"))).text();
  await (await routes.MODELS_CONFIG(new Request("http://web/api/models-config", { method: "PUT", body, headers: { "content-type": "application/json", cookie: "private=1" } }))).text();
  await (await routes.API_KEY(new Request("http://web/api/auth/api-key/dual-provider", { method: "POST", body, headers: { "content-type": "application/json" } }), context)).text();
  const oauth = await routes.LOGIN(new Request("http://web/api/auth/login/dual-provider"), context);
  const reader = oauth.body.getReader();
  const first = await reader.read();
  assert.equal(new TextDecoder().decode(first.value), 'data: {"type":"progress","message":"one"}\n\n');
  assert.equal(first.done, false, "SSE must not be buffered until completion");
  const second = await reader.read();
  assert.equal(new TextDecoder().decode(second.value), 'data: {"type":"success"}\n\n');

  assert.deepEqual(seen.map(({ method, path }) => [method, path]), [
    ["GET", "/internal/v1/api/models?cwd=%2Ftmp%2Fa%20b"],
    ["PUT", "/internal/v1/api/models-config"],
    ["POST", "/internal/v1/api/auth/api-key/dual-provider"],
    ["GET", "/internal/v1/api/auth/login/dual-provider"],
  ]);
  assert.equal(seen[1].body, body);
  assert.equal(seen[2].body, body);
  assert.equal(seen[1].headers.authorization, "Bearer service-token");
  assert.equal(seen[1].headers.cookie, undefined);
  assert.equal(oauth.headers.get("set-cookie"), null);
  assert.equal(oauth.headers.get("content-type"), "text/event-stream");
});

test("model/auth adapters reject malformed provider segments before Agent delivery", async () => {
  let delivered = false;
  const routes = createRemoteModelsAuthRoutes(async () => { delivered = true; return Response.json({}); });
  const response = await routes.LOGIN(new Request("http://web/api/auth/login/bad"), { params: Promise.resolve({ provider: "../bad" }) });
  assert.equal(response.status, 400);
  assert.equal(delivered, false);
});
