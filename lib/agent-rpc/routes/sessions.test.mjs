import assert from "node:assert/strict";
import { createServer } from "node:http";
import test from "node:test";
import { createJiti } from "jiti";
import { createAgentClient } from "../client.ts";

const { createRemoteSessionRoutes } = await createJiti(import.meta.url).import("./sessions.ts");

async function fixture(t) {
  const received = [];
  const server = createServer(async (request, response) => {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    received.push({ method: request.method, url: request.url, body: Buffer.concat(chunks).toString() });
    if (request.url.includes("/export")) {
      response.writeHead(200, { "content-type": "text/html", "content-disposition": "inline; filename=x.html", "content-security-policy": "frame-ancestors 'none'", "x-private": "drop" });
      response.end("<html>stream</html>");
    } else if (request.url.includes("tool-result-image")) {
      response.writeHead(200, { "content-type": "image/png", "content-length": "3", "x-content-type-options": "nosniff", "x-private": "drop" });
      response.end("png");
    } else {
      response.writeHead(207, { "content-type": "application/json", "x-request-id": "session-request" });
      response.end('{"literal":true}');
    }
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => { server.closeAllConnections(); return new Promise((resolve) => server.close(resolve)); });
  const send = createAgentClient({ baseUrl: `http://127.0.0.1:${server.address().port}`, token: "service-secret" }).fetch;
  return { received, routes: createRemoteSessionRoutes(send) };
}

const context = (id = "session-1") => ({ params: Promise.resolve({ id }) });
const entryContext = (id = "session-1", entryId = "entry-1") => ({ params: Promise.resolve({ id, entryId }) });

test("Session JSON routes preserve method, encoded query and body", async (t) => {
  const { routes, received } = await fixture(t);
  let response = await routes.LIST(new Request("http://web/api/sessions?force=1&x=%2Fone%20two"));
  assert.equal(response.status, 207);
  assert.equal(await response.text(), '{"literal":true}');
  response = await routes.DETAIL(new Request("http://web/api/sessions/session-1?tail=7&deferThinking=1"), context());
  assert.equal(response.headers.get("x-request-id"), "session-request");
  response = await routes.MUTATE(new Request("http://web/api/sessions/session-1", { method: "PATCH", headers: { "content-type": "application/json" }, body: '{"name":"new"}' }), context());
  await routes.CONTEXT(new Request("http://web/api/sessions/session-1/context?before=e%2F1&tail=2"), context());
  await routes.STATE(new Request("http://web/api/sessions/session-1/state"), context());
  await routes.AUTO_NAME(new Request("http://web/api/sessions/session-1/auto-name", { method: "POST" }), context());
  await routes.THINKING(new Request("http://web/api/sessions/session-1/entries/entry-1/thinking?blockIndex=0"), entryContext());
  assert.deepEqual(received.map(({ method, url, body }) => ({ method, url, body })), [
    { method: "GET", url: "/internal/v1/api/sessions?force=1&x=%2Fone%20two", body: "" },
    { method: "GET", url: "/internal/v1/api/sessions/session-1?tail=7&deferThinking=1", body: "" },
    { method: "PATCH", url: "/internal/v1/api/sessions/session-1", body: '{"name":"new"}' },
    { method: "GET", url: "/internal/v1/api/sessions/session-1/context?before=e%2F1&tail=2", body: "" },
    { method: "GET", url: "/internal/v1/api/sessions/session-1/state", body: "" },
    { method: "POST", url: "/internal/v1/api/sessions/session-1/auto-name", body: "" },
    { method: "GET", url: "/internal/v1/api/sessions/session-1/entries/entry-1/thinking?blockIndex=0", body: "" },
  ]);
});

test("Session export and image routes preserve only explicit stream headers", async (t) => {
  const { routes } = await fixture(t);
  const exported = await routes.EXPORT(new Request("http://web/api/sessions/session-1/export?inline=1"), context());
  assert.equal(await exported.text(), "<html>stream</html>");
  assert.equal(exported.headers.get("content-disposition"), "inline; filename=x.html");
  assert.equal(exported.headers.get("content-security-policy"), "frame-ancestors 'none'");
  assert.equal(exported.headers.get("x-private"), null);
  const image = await routes.TOOL_RESULT_IMAGE(new Request("http://web/api/sessions/session-1/entries/entry-1/tool-result-image?blockIndex=0"), entryContext());
  assert.equal(await image.text(), "png");
  assert.equal(image.headers.get("content-length"), "3");
  assert.equal(image.headers.get("x-content-type-options"), "nosniff");
  assert.equal(image.headers.get("x-private"), null);
});

test("Session routes reject invalid path parameters before Agent delivery", async (t) => {
  const { routes, received } = await fixture(t);
  assert.equal((await routes.DETAIL(new Request("http://web/api/sessions/x"), context("../escape"))).status, 400);
  assert.equal((await routes.THINKING(new Request("http://web/api/sessions/x"), entryContext("ok", "bad/entry"))).status, 400);
  assert.equal(received.length, 0);
});
