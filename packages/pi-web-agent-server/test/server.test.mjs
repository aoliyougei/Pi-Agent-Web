import assert from "node:assert/strict";
import test from "node:test";
import { createAgentServer } from "../dist/server.js";

const token = "server-secret";
const expectedVersion = {
  protocolVersion: 1,
  serverVersion: "0.1.0",
  piVersion: "0.84.4",
  piRevision: "b79e4cc834970cca69daebffab7df1da7d1e52c4",
  capabilities: ["extension-ui", "custom-ui", "remote-files", "subagents", "session-locks"],
};

async function startServer() {
  const app = createAgentServer({ token, version: expectedVersion });
  await app.listen("127.0.0.1", 0);
  const address = app.address();
  assert.ok(address && typeof address !== "string");
  return { app, url: `http://127.0.0.1:${address.port}` };
}

async function json(url, path, suppliedToken) {
  const headers = suppliedToken === undefined ? {} : { authorization: `Bearer ${suppliedToken}` };
  const response = await fetch(`${url}${path}`, { headers });
  return { status: response.status, body: await response.json() };
}

test("exposes only liveness without authentication", async (t) => {
  const { app, url } = await startServer();
  t.after(() => app.close());
  assert.deepEqual(await json(url, "/internal/v1/health/live"), { status: 200, body: { status: "ok" } });
  for (const path of ["/internal/v1/health/ready", "/internal/v1/version"]) {
    const result = await json(url, path);
    assert.equal(result.status, 401);
    assert.equal(result.body.error.code, "unauthorized");
  }
});

test("returns exact readiness and version for the service token", async (t) => {
  const { app, url } = await startServer();
  t.after(() => app.close());
  assert.deepEqual(await json(url, "/internal/v1/health/ready", token), { status: 200, body: { status: "ok" } });
  assert.deepEqual(await json(url, "/internal/v1/version", token), { status: 200, body: expectedVersion });
  assert.equal((await json(url, "/internal/v1/version", "wrong-token")).status, 401);
});

test("returns stable errors for unknown routes and shutdown readiness", async (t) => {
  const { app, url } = await startServer();
  t.after(() => app.close());
  const missing = await json(url, "/internal/v1/missing", token);
  assert.equal(missing.status, 404);
  assert.equal(missing.body.error.code, "invalid_request");
  app.beginShutdown();
  const ready = await json(url, "/internal/v1/health/ready", token);
  assert.equal(ready.status, 503);
  assert.equal(ready.body.error.code, "agent_unavailable");
});
