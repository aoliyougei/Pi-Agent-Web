import assert from "node:assert/strict";
import test from "node:test";
import { createAgentServer } from "../dist/server.js";

const token = "server-secret";
const version = {
  protocolVersion: 1,
  serverVersion: "0.1.0",
  piVersion: "0.84.4",
  piRevision: "b79e4cc834970cca69daebffab7df1da7d1e52c4",
  capabilities: ["extension-ui", "custom-ui", "remote-files", "subagents", "session-locks"],
};

async function startServer(agent) {
  const app = createAgentServer({ token, version, agent });
  await app.listen("127.0.0.1", 0);
  const address = app.address();
  assert.ok(address && typeof address !== "string");
  return { app, url: `http://127.0.0.1:${address.port}` };
}

function request(url, path, init = {}) {
  return fetch(`${url}${path}`, {
    ...init,
    headers: { authorization: `Bearer ${token}`, ...init.headers },
  });
}

function fakeAgent() {
  const commands = [];
  const runtime = {
    isRunning: () => true,
    send: async (command) => {
      commands.push(command);
      if (command.type === "get_state") {
        return { model: { id: "model-id", provider: "provider-id" }, thinkingLevel: "high" };
      }
      return { echoed: command.type };
    },
    close: async () => {},
  };
  return {
    commands,
    runtime,
    open: async (id) => id === "known" ? runtime : null,
    send: async (id, command) => id === "known"
      ? { found: true, data: await runtime.send(command) }
      : { found: false },
    create: async () => ({ id: "new-id", runtime }),
    running: () => ({
      runningSessionIds: ["known"],
      completionNotificationSuppressedSessionIds: [],
    }),
  };
}

async function body(response) {
  return { status: response.status, body: await response.json() };
}

test("serves authenticated Agent create, command, state, and running routes", async (t) => {
  const agent = fakeAgent();
  const { app, url } = await startServer(agent);
  t.after(() => app.close());

  assert.deepEqual(await body(await request(url, "/internal/v1/api/agent/running")), {
    status: 200,
    body: { runningSessionIds: ["known"], completionNotificationSuppressedSessionIds: [] },
  });
  assert.deepEqual(await body(await request(url, "/internal/v1/api/agent/known")), {
    status: 200,
    body: {
      running: true,
      state: { model: { id: "model-id", provider: "provider-id" }, thinkingLevel: "high" },
    },
  });
  assert.deepEqual(await body(await request(url, "/internal/v1/api/agent/known", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ type: "abort" }),
  })), { status: 200, body: { success: true, data: { echoed: "abort" } } });
  assert.deepEqual(await body(await request(url, "/internal/v1/api/agent/new", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ cwd: "/tmp", type: "ensure_session" }),
  })), {
    status: 200,
    body: {
      success: true,
      sessionId: "new-id",
      data: null,
      model: { provider: "provider-id", modelId: "model-id" },
      thinkingLevel: "high",
    },
  });
});

test("routes set_tools through the adapter and marks rejected prompts", async (t) => {
  const agent = fakeAgent();
  const sent = [];
  agent.send = async (id, command) => {
    sent.push({ id, command });
    if (command.type === "prompt") throw new Error("preflight rejected");
    return { found: true, data: { recreated: command.type === "set_tools" } };
  };
  const { app, url } = await startServer(agent);
  t.after(() => app.close());

  assert.deepEqual(await body(await request(url, "/internal/v1/api/agent/known", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ type: "set_tools", toolNames: ["read"] }),
  })), { status: 200, body: { success: true, data: { recreated: true } } });

  const rejected = await body(await request(url, "/internal/v1/api/agent/known", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ type: "prompt", message: "hello" }),
  }));
  assert.equal(rejected.status, 500);
  assert.equal(rejected.body.error.code, "prompt_rejected");
  assert.equal(rejected.body.accepted, false);
  assert.deepEqual(sent.map(({ command }) => command.type), ["set_tools", "prompt"]);
});

test("deduplicates matching side-effect requests by request id", async (t) => {
  const agent = fakeAgent();
  let calls = 0;
  agent.send = async () => {
    calls += 1;
    await new Promise((resolve) => setTimeout(resolve, 10));
    return { found: true, data: { call: calls } };
  };
  const { app, url } = await startServer(agent);
  t.after(() => app.close());
  const init = {
    method: "POST",
    headers: { "content-type": "application/json", "x-request-id": "dedup-1" },
    body: JSON.stringify({ type: "abort" }),
  };

  const [first, second] = await Promise.all([
    body(await request(url, "/internal/v1/api/agent/known", init)),
    body(await request(url, "/internal/v1/api/agent/known", init)),
  ]);

  assert.deepEqual(first, { status: 200, body: { success: true, data: { call: 1 } } });
  assert.deepEqual(second, first);
  assert.equal(calls, 1);
});

test("rejects malformed requests before opening or invoking a Runtime", async (t) => {
  const agent = fakeAgent();
  let opens = 0;
  agent.open = async () => { opens += 1; return agent.runtime; };
  const { app, url } = await startServer(agent);
  t.after(() => app.close());

  const cases = [
    ["/internal/v1/api/agent/%2Fescape", { method: "POST", headers: { "content-type": "application/json" }, body: '{"type":"abort"}' }, 400],
    ["/internal/v1/api/agent/known", { method: "POST", headers: { "content-type": "text/plain" }, body: '{"type":"abort"}' }, 415],
    ["/internal/v1/api/agent/known", { method: "POST", headers: { "content-type": "application/json" }, body: '{"type":' }, 400],
    ["/internal/v1/api/agent/known", { method: "POST", headers: { "content-type": "application/json" }, body: '{"type":"prompt"}' }, 400],
    ["/internal/v1/api/agent/known", { method: "POST", headers: { "content-type": "application/json" }, body: '{"type":"abort","__proto__":{}}' }, 400],
  ];
  for (const [path, init, status] of cases) assert.equal((await request(url, path, init)).status, status);
  assert.equal(opens, 0);
  assert.deepEqual(agent.commands, []);
});

test("returns bounded 404, 409, and 413 failures", async (t) => {
  const agent = fakeAgent();
  const locked = Object.assign(new Error("Session is locked"), { code: "session_locked" });
  agent.open = async () => null;
  agent.send = async (id) => {
    if (id === "locked") throw locked;
    return { found: false };
  };
  const { app, url } = await startServer(agent);
  t.after(() => app.close());

  assert.equal((await request(url, "/internal/v1/api/agent/missing", {
    method: "POST", headers: { "content-type": "application/json" }, body: '{"type":"abort"}',
  })).status, 404);
  assert.equal((await request(url, "/internal/v1/api/agent/locked", {
    method: "POST", headers: { "content-type": "application/json" }, body: '{"type":"abort"}',
  })).status, 409);
  assert.equal((await request(url, "/internal/v1/api/agent/known", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ type: "prompt", message: "x".repeat(12 * 1024 * 1024) }),
  })).status, 413);
});
