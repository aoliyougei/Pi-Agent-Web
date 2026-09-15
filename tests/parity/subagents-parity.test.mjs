import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createJiti } from "jiti";

const root = mkdtempSync(join(tmpdir(), "pi-subagents-parity-"));
process.env.PI_CODING_AGENT_DIR = join(root, "agent");
const { createAgentServer } = await import("../../packages/pi-web-agent-server/dist/server.js");
const jiti = createJiti(import.meta.url);
const { createAgentClient } = await jiti.import("../../lib/agent-rpc/client.ts");
const { createRemoteSubagentRoutes } = await jiti.import("../../lib/agent-rpc/routes/subagents.ts");
const token = "subagents-parity-token";
const id = "subagent-parity";
const context = { params: Promise.resolve({ id }) };

async function snapshot(response) {
  return {
    status: response.status,
    type: response.headers.get("content-type"),
    body: new Uint8Array(await response.arrayBuffer()),
  };
}

function installRuntime() {
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
      description: "Parity",
      task: "Inspect parity",
      runInBackground: true,
      createdAt: "2026-01-01T00:00:00.000Z",
    },
  }];
  globalThis.__piSubagentRuns = new Map();
  globalThis.__piAgentServerSessions = new Map([[id, {
    isAlive: () => true,
    isRunning: () => true,
    sessionFile: `/tmp/${id}.jsonl`,
    inner: {
      sessionManager: { getEntries: () => entries },
      steer: async () => {},
      abort: async () => {},
    },
  }]]);
}

test("subagent BFF responses equal authenticated Agent responses byte-for-byte", async (t) => {
  const previousRegistry = globalThis.__piAgentServerSessions;
  const previousRuns = globalThis.__piSubagentRuns;
  installRuntime();
  const app = createAgentServer({ token, version: { protocolVersion: 1 } });
  await app.listen("127.0.0.1", 0);
  t.after(async () => {
    await app.close();
    globalThis.__piAgentServerSessions = previousRegistry;
    globalThis.__piSubagentRuns = previousRuns;
    rmSync(root, { recursive: true, force: true });
  });
  const base = `http://127.0.0.1:${app.address().port}`;
  const routes = createRemoteSubagentRoutes(createAgentClient({ baseUrl: base, token }).fetch);
  const auth = { authorization: `Bearer ${token}` };

  assert.deepEqual(
    await snapshot(await routes.GET(new Request(`http://web/api/subagents/${id}`), context)),
    await snapshot(await fetch(`${base}/internal/v1/api/subagents/${id}`, { headers: auth })),
  );

  const body = '{ "action": "steer", "message": "focus" }\n';
  assert.deepEqual(
    await snapshot(await routes.POST(new Request(`http://web/api/subagents/${id}`, { method: "POST", body }), context)),
    await snapshot(await fetch(`${base}/internal/v1/api/subagents/${id}`, {
      method: "POST", headers: { ...auth, "content-type": "application/json" }, body,
    })),
  );

  const missingContext = { params: Promise.resolve({ id: "missing-subagent" }) };
  assert.deepEqual(
    await snapshot(await routes.GET(new Request("http://web/api/subagents/missing-subagent"), missingContext)),
    await snapshot(await fetch(`${base}/internal/v1/api/subagents/missing-subagent`, { headers: auth })),
  );
});
