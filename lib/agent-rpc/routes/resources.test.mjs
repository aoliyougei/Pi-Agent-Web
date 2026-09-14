import assert from "node:assert/strict";
import { createServer } from "node:http";
import test from "node:test";
import { createJiti } from "jiti";
import { createAgentClient } from "../client.ts";

const { createRemoteResourceRoutes } = await createJiti(import.meta.url).import("./resources.ts");

test("resource adapters preserve fixed paths, methods, queries, and raw JSON", async (t) => {
  const seen = [];
  const server = createServer(async (request, response) => {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    seen.push({
      method: request.method,
      path: request.url,
      body: Buffer.concat(chunks).toString(),
      authorization: request.headers.authorization,
      cookie: request.headers.cookie,
    });
    response.writeHead(200, {
      "content-type": "application/json",
      "x-request-id": "resources-1",
      "set-cookie": "secret=1",
    });
    response.end('{"ok":true}');
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  const routes = createRemoteResourceRoutes(createAgentClient({ baseUrl, token: "service-token" }).fetch);
  const body = '{ "cwd": "/tmp/a b" }\n';

  await (await routes.SKILLS(new Request("http://web/api/skills?cwd=%2Ftmp%2Fa%20b"))).text();
  await (await routes.SKILL_INSTALL(new Request("http://web/api/skills/install", {
    method: "POST",
    headers: { "content-type": "application/json", cookie: "private=1" },
    body,
  }))).text();
  await (await routes.PLUGINS(new Request("http://web/api/plugins?cwd=%2Ftmp%2Fa%20b"))).text();
  await (await routes.SUBAGENT_PROFILES(new Request("http://web/api/subagents/profiles", {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body,
  }))).text();

  assert.deepEqual(seen.map(({ method, path }) => [method, path]), [
    ["GET", "/internal/v1/api/skills?cwd=%2Ftmp%2Fa%20b"],
    ["POST", "/internal/v1/api/skills/install"],
    ["GET", "/internal/v1/api/plugins?cwd=%2Ftmp%2Fa%20b"],
    ["PATCH", "/internal/v1/api/subagents/profiles"],
  ]);
  assert.equal(seen[1].body, body);
  assert.equal(seen[3].body, body);
  assert.equal(seen[1].authorization, "Bearer service-token");
  assert.equal(seen[1].cookie, undefined);
});

test("legacy unguarded resource mutations preserve JSON bytes without requiring a browser content type", async () => {
  let seen;
  const routes = createRemoteResourceRoutes(async (path, init) => {
    seen = { path, type: new Headers(init.headers).get("content-type"), body: await new Response(init.body).text() };
    return Response.json({ ok: true });
  });
  const body = '{ "enabled": true }\n';
  const response = await routes.SKILLS(new Request("http://web/api/skills", { method: "PATCH", headers: { "content-type": "text/plain" }, body }));
  assert.equal(response.status, 200);
  assert.deepEqual(seen, { path: "/internal/v1/api/skills", type: "application/json", body });
});

test("resource adapters expose only the ten fixed capabilities", () => {
  const routes = createRemoteResourceRoutes(async () => Response.json({}));
  assert.deepEqual(Object.keys(routes).sort(), [
    "PLUGINS",
    "PROJECT_TRUST",
    "SKILLS",
    "SKILL_CHECK",
    "SKILL_INSTALL",
    "SKILL_SEARCH",
    "SKILL_UPDATE",
    "SUBAGENT_PROFILES",
    "SUBAGENT_SETTINGS",
    "TOOLS_SETTINGS",
  ]);
});
