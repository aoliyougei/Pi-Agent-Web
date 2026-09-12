import assert from "node:assert/strict";
import { createServer } from "node:http";
import test from "node:test";
import { createJiti } from "jiti";
import { createAgentClient } from "./client.ts";

const { proxyStream } = await createJiti(import.meta.url).import("./stream-proxy.ts");

async function fixture(t, handler) {
  const server = createServer(handler);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => { server.closeAllConnections(); return new Promise((resolve) => server.close(resolve)); });
  return createAgentClient({ baseUrl: `http://127.0.0.1:${server.address().port}`, token: "service-secret" }).fetch;
}

test("proxyStream returns the first byte before completion and only allowed response headers", { timeout: 5000 }, async (t) => {
  let finish;
  const blocked = new Promise((resolve) => { finish = resolve; });
  const send = await fixture(t, async (_req, res) => {
    res.writeHead(206, {
      "content-type": "application/octet-stream", "content-disposition": "attachment; filename=x",
      etag: '"v1"', "last-modified": "Wed, 11 Sep 2024 00:00:00 GMT", "accept-ranges": "bytes",
      "content-range": "bytes 0-1/4", "x-private": "secret", "set-cookie": "internal=secret",
    });
    res.write("ab");
    await blocked;
    res.end("cd");
  });
  const response = await proxyStream(new Request("http://web/file"), "/internal/v1/file", send,
    ["content-type", "content-disposition", "etag", "last-modified", "accept-ranges", "content-range"]);
  assert.equal(response.status, 206);
  const reader = response.body.getReader();
  assert.equal(new TextDecoder().decode((await reader.read()).value), "ab");
  assert.equal(response.headers.get("etag"), '"v1"');
  assert.equal(response.headers.get("content-range"), "bytes 0-1/4");
  assert.equal(response.headers.get("x-private"), null);
  assert.equal(response.headers.get("set-cookie"), null);
  finish();
  assert.equal(new TextDecoder().decode((await reader.read()).value), "cd");
  await reader.cancel();
});

test("proxyStream propagates reader cancellation to Agent", { timeout: 5000 }, async (t) => {
  let closed;
  const disconnected = new Promise((resolve) => { closed = resolve; });
  const send = await fixture(t, (_req, res) => {
    res.on("close", closed);
    res.writeHead(200, { "content-type": "text/event-stream" });
    res.write("data: one\n\n");
  });
  const response = await proxyStream(new Request("http://web/events"), "/internal/v1/events", send, ["content-type"]);
  const reader = response.body.getReader();
  assert.equal(new TextDecoder().decode((await reader.read()).value), "data: one\n\n");
  await reader.cancel();
  await disconnected;
});

test("proxyStream rejects redirects and strips location", async (t) => {
  const send = await fixture(t, (_req, res) => res.writeHead(307, { location: "http://attacker.invalid" }).end());
  const response = await proxyStream(new Request("http://web/file"), "/internal/v1/file", send, ["content-type", "location"]);
  assert.equal(response.status, 502);
  assert.equal(response.headers.get("location"), null);
  assert.deepEqual(await response.json(), { error: "Invalid Agent response", code: "agent_bad_gateway" });
});
