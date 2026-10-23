import assert from "node:assert/strict";
import { createServer } from "node:http";
import test from "node:test";
import { createAgentClient } from "./client.ts";
import { checkAgentCompatibility } from "./version-check.ts";

const token = "client-secret";
const compatibleVersion = {
  protocolVersion: 1,
  serverVersion: "0.1.0",
  piVersion: "0.84.4",
  piRevision: "b79e4cc834970cca69daebffab7df1da7d1e52c4",
  capabilities: ["extension-ui", "custom-ui", "remote-files", "subagents", "session-locks"],
};

async function fixture(handler) {
  const server = createServer(handler);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  return {
    url: `http://127.0.0.1:${address.port}`,
    close: () => new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve())),
  };
}

test("injects service identity while stripping browser and hop-by-hop headers", async (t) => {
  let received;
  const upstream = await fixture((request, response) => {
    received = request.headers;
    response.writeHead(200).end("ok");
  });
  t.after(upstream.close);
  const client = createAgentClient({ baseUrl: upstream.url, token });
  const response = await client.fetch("/internal/v1/version", {
    headers: {
      authorization: "Bearer browser-token",
      cookie: "private=browser",
      host: "attacker.invalid",
      connection: "close",
      "x-request-id": "request-1",
      "x-kept": "yes",
    },
  });
  assert.equal(await response.text(), "ok");
  assert.equal(received.authorization, `Bearer ${token}`);
  assert.equal(received.cookie, undefined);
  assert.notEqual(received.host, "attacker.invalid");
  assert.notEqual(received.connection, "close");
  assert.equal(received["x-pi-agent-protocol"], "1");
  assert.equal(received["x-request-id"], "request-1");
  assert.equal(received["x-kept"], "yes");
});

test("generates one request id and preserves an explicit id", async (t) => {
  const ids = [];
  const upstream = await fixture((request, response) => {
    ids.push(request.headers["x-request-id"]);
    response.writeHead(200).end();
  });
  t.after(upstream.close);
  const client = createAgentClient({ baseUrl: upstream.url, token });
  await client.fetch("/internal/v1/one");
  await client.fetch("/internal/v1/two", { headers: { "x-request-id": "stable-id" } });
  assert.match(ids[0], /^[0-9a-f-]{36}$/);
  assert.equal(ids[1], "stable-id");
});

test("rejects unsafe agent base URLs and request paths", async () => {
  for (const baseUrl of ["file:///tmp/socket", "http://user:pass@agent.internal"]) {
    assert.throws(() => createAgentClient({ baseUrl, token }), /agent RPC URL/i);
  }
  const client = createAgentClient({ baseUrl: "http://agent.internal", token });
  for (const path of ["https://attacker.invalid/", "//attacker.invalid/", "/public/path", "/internal/v1/../public/path"]) {
    await assert.rejects(() => client.fetch(path), /agent RPC path/i);
  }
});

test("accepts HTTPS and does not follow redirects with service tokens", async (t) => {
  assert.doesNotThrow(() => createAgentClient({ baseUrl: "https://agent.internal:8443", token }));
  let leaked = false;
  const target = await fixture((_request, response) => { leaked = true; response.end(); });
  t.after(target.close);
  const source = await fixture((_request, response) => { response.writeHead(302, { location: target.url }).end(); });
  t.after(source.close);
  const response = await createAgentClient({ baseUrl: source.url, token }).fetch("/internal/v1/version");
  assert.equal(response.status, 302);
  assert.equal(leaked, false);
});

test("maps connection failures without leaking URL or token", async () => {
  const client = createAgentClient({ baseUrl: "http://127.0.0.1:1", token });
  await assert.rejects(
    () => client.fetch("/internal/v1/version"),
    (error) => error.code === "agent_unavailable" && !error.message.includes(token) && !error.message.includes("127.0.0.1"),
  );
});

test("accepts supported legacy and RPC 0.2.0 Pi versions with required capabilities", () => {
  assert.deepEqual(checkAgentCompatibility(compatibleVersion), compatibleVersion);
  const upgraded = { ...compatibleVersion, serverVersion: "0.2.0", piVersion: "1.2.0" };
  assert.deepEqual(checkAgentCompatibility(upgraded), upgraded);
  const pi140 = { ...compatibleVersion, piVersion: "1.4.0" };
  assert.deepEqual(checkAgentCompatibility(pi140), pi140);
  for (const version of [
    { ...pi140, protocolVersion: 2 },
    ...pi140.capabilities.map((missing) => ({ ...pi140, capabilities: pi140.capabilities.filter(value => value !== missing) })),
    ...["1.3.0", "1.4.1", "1.4.0-rc.1", "1.5.0", "2.0.0"].map(piVersion => ({ ...pi140, piVersion })),
    { ...compatibleVersion, piVersion: "0.84.3" },
    { ...compatibleVersion, capabilities: compatibleVersion.capabilities.slice(0, -1) },
    { ...compatibleVersion, protocolVersion: 2 },
  ]) {
    assert.throws(() => checkAgentCompatibility(version), /incompatible agent/i);
  }
});
