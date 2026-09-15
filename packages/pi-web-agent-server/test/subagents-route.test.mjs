import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

const agentDir = mkdtempSync(join(tmpdir(), "pi-subagents-route-agent-"));
process.env.PI_CODING_AGENT_DIR = agentDir;
const { createAgentServer } = await import("../dist/server.js");
const token = "subagents-route-token";
test.after(() => rmSync(agentDir, { recursive: true, force: true }));

async function start(t) {
  const app = createAgentServer({ token, version: { protocolVersion: 1 } });
  await app.listen("127.0.0.1", 0);
  t.after(() => app.close());
  return `http://127.0.0.1:${app.address().port}`;
}

async function request(base, path, init = {}) {
  const response = await fetch(base + path, {
    ...init,
    headers: {
      authorization: `Bearer ${token}`,
      ...(init.body ? { "content-type": "application/json" } : {}),
      ...init.headers,
    },
  });
  return { status: response.status, body: await response.json() };
}

const post = (value) => ({ method: "POST", body: JSON.stringify(value) });
const id = "subagent-route-test";

function installRunningSubagent(t) {
  const previousRegistry = globalThis.__piAgentServerSessions;
  const previousRuns = globalThis.__piSubagentRuns;
  let running = true;
  const steered = [];
  let aborts = 0;
  const entries = [{
    type: "custom",
    customType: "pi-web:subagent",
    id: "meta",
    parentId: null,
    timestamp: "2026-01-01T00:00:00.000Z",
    data: {
      version: 1,
      parentSessionId: "parent",
      parentSessionPath: "/tmp/parent.jsonl",
      parentToolCallId: "tool-call",
      profile: "Explore",
      description: "Inspect",
      task: "Inspect files",
      runInBackground: true,
      createdAt: "2026-01-01T00:00:00.000Z",
    },
  }];
  globalThis.__piSubagentRuns = new Map();
  globalThis.__piAgentServerSessions = new Map([[id, {
    isAlive: () => true,
    isRunning: () => running,
    sessionFile: `/tmp/${id}.jsonl`,
    inner: {
      sessionManager: { getEntries: () => entries },
      steer: async (message) => { steered.push(message); },
      abort: async () => { aborts += 1; },
    },
  }]]);
  t.after(() => {
    globalThis.__piAgentServerSessions = previousRegistry;
    globalThis.__piSubagentRuns = previousRuns;
  });
  return {
    steered,
    get aborts() { return aborts; },
    stop() { running = false; },
  };
}

test("Agent subagent route reads live state and accepts steer and abort", async (t) => {
  const base = await start(t);
  const state = installRunningSubagent(t);

  let response = await request(base, `/internal/v1/api/subagents/${id}`);
  assert.equal(response.status, 200);
  assert.equal(response.body.run.status, "running");
  assert.equal(response.body.run.profile, "Explore");

  response = await request(base, `/internal/v1/api/subagents/${id}`, post({ action: "steer", message: "  focus on tests  " }));
  assert.equal(response.status, 200);
  assert.deepEqual(state.steered, ["focus on tests"]);

  response = await request(base, `/internal/v1/api/subagents/${id}`, post({ action: "abort" }));
  assert.equal(response.status, 200);
  assert.equal(state.aborts, 1);
});

test("Agent subagent route preserves validation, conflict, and missing responses", async (t) => {
  const base = await start(t);
  const state = installRunningSubagent(t);

  assert.equal((await request(base, `/internal/v1/api/subagents/${id}`, post({ action: "steer", message: "  " }))).status, 400);
  assert.equal((await request(base, `/internal/v1/api/subagents/${id}`, post({ action: "unknown" }))).status, 400);
  assert.equal((await request(base, `/internal/v1/api/subagents/${id}`, {
    method: "POST", headers: { "content-type": "text/plain" }, body: JSON.stringify({ action: "abort" }),
  })).status, 415);

  state.stop();
  const conflict = await request(base, `/internal/v1/api/subagents/${id}`, post({ action: "abort" }));
  assert.equal(conflict.status, 409);
  assert.match(conflict.body.error, /not running/);

  globalThis.__piAgentServerSessions = new Map();
  assert.equal((await request(base, "/internal/v1/api/subagents/missing-subagent")).status, 404);
  assert.equal((await request(base, "/internal/v1/api/subagents/%2Fescape")).status, 400);
  for (const reserved of ["profiles", "settings", "%70rofiles"]) {
    assert.equal((await request(base, `/internal/v1/api/subagents/${reserved}`, post({ action: "abort" }))).status, 404);
  }
});
