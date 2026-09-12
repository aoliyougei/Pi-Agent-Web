import assert from "node:assert/strict";
import { createServer } from "node:http";
import test from "node:test";
import { createJiti } from "jiti";
import { createAgentClient } from "./client.ts";

const { proxyJson } = await createJiti(import.meta.url).import("./proxy.ts");

async function fixture(t, handler) {
  const server = createServer(handler);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => { server.closeAllConnections(); return new Promise((resolve) => server.close(resolve)); });
  return createAgentClient({ baseUrl: `http://127.0.0.1:${server.address().port}`, token: "service-secret" }).fetch;
}

test("proxyJson preserves method, encoded query, JSON bytes, status and request id", async (t) => {
  let received;
  const send = await fixture(t, async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    received = { method: req.method, url: req.url, type: req.headers["content-type"], body: Buffer.concat(chunks).toString() };
    res.writeHead(422, { "content-type": "application/json", "x-request-id": "req-1" });
    res.end('{"error":"literal"}');
  });
  const body = '{ "value": "你好" }\n';
  const response = await proxyJson(new Request("http://web/api/x?a=%2Fone%20two", {
    method: "PATCH", body, headers: { "content-type": "application/json; charset=utf-8", "x-request-id": "req-1" },
  }), "/internal/v1/api/x?a=%2Fone%20two", send);
  assert.deepEqual(received, { method: "PATCH", url: "/internal/v1/api/x?a=%2Fone%20two", type: "application/json; charset=utf-8", body });
  assert.equal(response.status, 422);
  assert.equal(response.headers.get("x-request-id"), "req-1");
  assert.equal(await response.text(), '{"error":"literal"}');
});

test("proxyJson rejects non-JSON and oversized bodies before Agent delivery", async (t) => {
  let calls = 0;
  const send = await fixture(t, (_req, res) => { calls++; res.end("unexpected"); });
  const wrongType = await proxyJson(new Request("http://web/api/x", { method: "POST", body: "x", headers: { "content-type": "text/plain" } }), "/internal/v1/api/x", send);
  assert.equal(wrongType.status, 415);
  assert.deepEqual(await wrongType.json(), { error: "Content-Type must be application/json", code: "invalid_request" });
  const invalidJsonType = await proxyJson(new Request("http://web/api/x", { method: "POST", body: "{}", headers: { "content-type": "application/json-malformed" } }), "/internal/v1/api/x", send);
  assert.equal(invalidJsonType.status, 415);
  const oversized = await proxyJson(new Request("http://web/api/x", { method: "POST", body: "{}", headers: { "content-type": "application/json", "content-length": String(12 * 1024 * 1024 + 1) } }), "/internal/v1/api/x", send);
  assert.equal(oversized.status, 413);
  assert.deepEqual(await oversized.json(), { error: "Request body too large", code: "request_too_large" });
  assert.equal(calls, 0);
});

test("proxyJson cancels a chunked body as soon as it exceeds the limit", async (t) => {
  let calls = 0, pulls = 0, cancelled = false;
  const send = await fixture(t, (_req, res) => { calls++; res.end("unexpected"); });
  const sizes = [6 * 1024 * 1024, 6 * 1024 * 1024, 1];
  const body = new ReadableStream({
    pull(controller) {
      if (pulls === sizes.length) throw new Error("read beyond limit");
      controller.enqueue(new Uint8Array(sizes[pulls++]));
    },
    cancel() { cancelled = true; },
  });
  const response = await proxyJson(new Request("http://web/api/x", {
    method: "POST", body, duplex: "half", headers: { "content-type": "application/json" },
  }), "/internal/v1/api/x", send);
  assert.equal(response.status, 413);
  assert.equal(cancelled, true);
  assert.equal(pulls, 3);
  assert.equal(calls, 0);
});

test("proxyJson returns quietly when the browser disconnects during body delivery", async () => {
  const controller = new AbortController();
  const body = new ReadableStream({
    start(stream) {
      controller.signal.addEventListener("abort", () => stream.error(controller.signal.reason));
    },
  });
  const pending = proxyJson(new Request("http://web/api/x", {
    method: "POST", body, duplex: "half", signal: controller.signal,
    headers: { "content-type": "application/json" },
  }), "/internal/v1/api/x", async () => { throw new Error("must not deliver"); });
  controller.abort();
  assert.equal((await pending).status, 204);
});

test("proxyJson maps transport failures without leaking Agent details", async () => {
  const send = createAgentClient({ baseUrl: "http://127.0.0.1:1", token: "service-secret" }).fetch;
  const response = await proxyJson(new Request("http://web/api/x"), "/internal/v1/api/x", send);
  assert.equal(response.status, 503);
  const text = await response.text();
  assert.deepEqual(JSON.parse(text), { error: "Agent service unavailable", code: "agent_unavailable" });
  assert.doesNotMatch(text, /service-secret|127\.0\.0\.1|stack/);
});
