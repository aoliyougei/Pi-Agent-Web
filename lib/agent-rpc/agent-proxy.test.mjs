import assert from "node:assert/strict";
import { createServer } from "node:http";
import test from "node:test";
import { createJiti } from "jiti";
import { createAgentClient } from "./client.ts";

const { createRemoteAgentRoutes } = await createJiti(import.meta.url).import("./routes/agent.ts");

async function fixture(t, handler) {
  const server = createServer(handler);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => { server.closeAllConnections(); return new Promise((resolve) => server.close(resolve)); });
  const url = `http://127.0.0.1:${server.address().port}`;
  return { url, routes: createRemoteAgentRoutes(createAgentClient({ baseUrl: url, token: "service-secret" }).fetch) };
}
const context = (id = "session-1") => ({ params: Promise.resolve({ id }) });

// Removing body streaming, changing status, or forwarding browser identity breaks this check.
test("inactive command adapter preserves bytes/status/request id while isolating credentials", async (t) => {
  let received;
  const upstream = await fixture(t, async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    received = { path: req.url, headers: req.headers, body: Buffer.concat(chunks).toString() };
    res.writeHead(409, { "content-type": "application/json", "x-request-id": "request-7", "set-cookie": "internal=secret", "connection": "x-private", "x-private": "secret" });
    res.end('{"error":{"code":"session_locked","message":"busy"}}');
  });
  const body = '{ "type": "prompt", "message": "你好" }\n';
  const response = await upstream.routes.POST(new Request("http://web/api/agent/session-1", {
    method: "POST", body,
    headers: { "content-type": "application/json", authorization: "Bearer browser-secret", cookie: "login=private", "x-request-id": "request-7", "x-forwarded-user": "admin" },
  }), context());
  assert.equal(response.status, 409);
  assert.deepEqual(await response.json(), { error: "busy", code: "session_locked" });
  assert.equal(response.headers.get("x-request-id"), "request-7");
  for (const name of ["set-cookie", "connection", "x-private"]) assert.equal(response.headers.get(name), null);
  assert.equal(received.path, "/internal/v1/api/agent/session-1");
  assert.equal(received.body, body);
  assert.equal(received.headers.authorization, "Bearer service-secret");
  assert.equal(received.headers.cookie, undefined);
  assert.equal(received.headers["x-forwarded-user"], undefined);
  assert.equal(received.headers["x-request-id"], "request-7");
});

test("SSE forwards cwd while translating cursor to Last-Event-ID", async (t) => {
  let received;
  const { routes } = await fixture(t, (req, res) => {
    received = { url: req.url, cursor: req.headers["last-event-id"] };
    res.writeHead(200, { "content-type": "text/event-stream" }).end('data: {"type":"ready"}\n\n');
  });
  const response = await routes.EVENTS(new Request("http://web/api/agent/session-1/events?cwd=%2Fworkspace%2FA&cursor=event-7"), context());
  await response.text();
  assert.deepEqual(received, { url: "/internal/v1/api/agent/session-1/events?cwd=%2Fworkspace%2FA", cursor: "event-7" });
});

test("new/running/state/bash adapters map only their fixed route and preserve query encoding", async (t) => {
  const seen = [];
  const { routes } = await fixture(t, (req, res) => {
    seen.push([req.method, req.url]);
    res.writeHead(200, { "content-type": "text/plain", "content-disposition": 'attachment; filename="bash-output.log"' }).end("output");
  });
  await (await routes.NEW(new Request("http://web/api/agent/new", { method: "POST", body: '{"type":"ensure_session"}' }))).text();
  await (await routes.RUNNING(new Request("http://web/api/agent/running"))).text();
  await (await routes.GET(new Request("http://web/api/agent/session-1"), context())).text();
  const output = await routes.BASH_OUTPUT(new Request("http://web/api/agent/session-1/bash-output?path=%2Ftmp%2Fa%20b&download=1"), context());
  assert.equal(await output.text(), "output");
  assert.equal(output.headers.get("content-disposition"), 'attachment; filename="bash-output.log"');
  assert.deepEqual(seen, [
    ["POST", "/internal/v1/api/agent/new"], ["GET", "/internal/v1/api/agent/running"],
    ["GET", "/internal/v1/api/agent/session-1?start=false"], ["GET", "/internal/v1/api/agent/session-1/bash-output?path=%2Ftmp%2Fa%20b&download=1"],
  ]);
  for (const id of ["..", "%2e%2e", "a/b", "a?x=1", "", "new", "running"]) {
    assert.equal((await routes.GET(new Request("http://web/api/agent/ignored"), context(id))).status, 400);
  }
  assert.equal(seen.length, 4);
});

test("SSE arrives before upstream completion with exact IDs/data and reader cancellation closes upstream", { timeout: 8000 }, async (t) => {
  let lastId;
  let closed;
  const disconnected = new Promise((resolve) => { closed = resolve; });
  const { routes } = await fixture(t, (req, res) => {
    lastId = req.headers["last-event-id"];
    res.on("close", closed);
    res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache, no-transform", "x-accel-buffering": "no" });
    res.write('id: 12\ndata: {"type":"connected"}\n\n: heartbeat\n\n');
  });
  const response = await routes.EVENTS(new Request("http://web/api/agent/session-1/events", { headers: { "last-event-id": "11" } }), context());
  assert.equal(response.headers.get("content-type"), "text/event-stream");
  assert.equal(response.headers.get("x-accel-buffering"), "no");
  const reader = response.body.getReader();
  assert.equal(new TextDecoder().decode((await reader.read()).value), 'id: 12\ndata: {"type":"connected"}\n\n: heartbeat\n\n');
  assert.equal(lastId, "11");
  await reader.cancel();
  await disconnected;
});

test("expired SSE cursor emits browser resync control without retrying commands", async (t) => {
  let calls = 0;
  const { routes } = await fixture(t, (req, res) => {
    calls++;
    res.writeHead(409, { "content-type": "application/json" }).end('{"error":{"code":"resync_required","message":"expired"}}');
  });
  const response = await routes.EVENTS(new Request("http://web/events", { headers: { "last-event-id": "1" } }), context());
  assert.equal(response.status, 200);
  assert.equal(await response.text(), 'data: {"type":"resync_required"}\n\n');
  assert.equal(calls, 1);
});

test("browser abort cancels upstream before headers; pre-aborted request never connects", { timeout: 8000 }, async (t) => {
  let arrived, closed, calls = 0;
  const arrival = new Promise((resolve) => { arrived = resolve; });
  const departure = new Promise((resolve) => { closed = resolve; });
  const { routes } = await fixture(t, (req, res) => { calls++; res.on("close", closed); arrived(); });
  const controller = new AbortController();
  const pending = routes.GET(new Request("http://web/state", { signal: controller.signal }), context());
  await arrival;
  controller.abort();
  assert.equal((await pending).status, 204);
  await departure;
  assert.equal((await routes.GET(new Request("http://web/state", { signal: controller.signal }), context())).status, 204);
  assert.equal(calls, 1);
});

test("redirects never forward service credentials and unavailable errors expose no secrets", async (t) => {
  let leaked = false;
  const trap = await fixture(t, (_req, res) => { leaked = true; res.end("wrong"); });
  const { routes } = await fixture(t, (_req, res) => { res.writeHead(307, { location: `${trap.url}/internal/v1/capture` }).end(); });
  const response = await routes.GET(new Request("http://web/state"), context());
  assert.equal(response.status, 502);
  assert.equal(leaked, false);
  assert.equal(response.headers.get("location"), null);
  const offline = createRemoteAgentRoutes(createAgentClient({ baseUrl: "http://127.0.0.1:1", token: "service-secret" }).fetch);
  const failed = await offline.POST(new Request("http://web/command", { method: "POST", body: '{"type":"prompt"}' }), context());
  assert.equal(failed.status, 503);
  const error = await failed.json();
  assert.equal(error.code, "agent_unavailable");
  assert.equal("accepted" in error, false, "transport loss cannot prove the prompt was rejected");
  assert.doesNotMatch(JSON.stringify(error), /service-secret|127\.0\.0\.1/);
});
