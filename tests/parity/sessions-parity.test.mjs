import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { createJiti } from "jiti";

const root = mkdtempSync(join(tmpdir(), "pi-session-parity-"));
process.env.PI_CODING_AGENT_DIR = join(root, "agent");
const { SessionManager } = await import("@earendil-works/pi-coding-agent");
const { createAgentServer } = await import("../../packages/pi-web-agent-server/dist/server.js");
const jiti = createJiti(import.meta.url);
const { createAgentClient } = await jiti.import("../../lib/agent-rpc/client.ts");
const { createRemoteSessionRoutes } = await jiti.import("../../lib/agent-rpc/routes/sessions.ts");
const token = "parity-token";

function fixture() {
  const manager = SessionManager.create(root);
  manager.appendSessionInfo("Parity");
  manager.appendMessage({ role: "user", content: "parity prompt", timestamp: 1000 });
  const assistantId = manager.appendMessage({
    role: "assistant",
    content: [{ type: "thinking", thinking: "private reasoning" }, { type: "text", text: "parity answer" }],
    provider: "phase3", model: "echo", stopReason: "stop", timestamp: 2000,
    usage: { input: 2, output: 3, cacheRead: 0, cacheWrite: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
  });
  const file = manager.getSessionFile();
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, [manager.getHeader(), ...manager.getEntries()].map((entry) => JSON.stringify(entry)).join("\n") + "\n{malformed\n");
  return { id: manager.getSessionId(), assistantId };
}

async function bytes(response) {
  return {
    status: response.status,
    type: response.headers.get("content-type"),
    cache: response.headers.get("cache-control"),
    body: new Uint8Array(await response.arrayBuffer()),
  };
}

test("Session BFF responses equal authenticated Agent responses byte-for-byte", async (t) => {
  const { id, assistantId } = fixture();
  const app = createAgentServer({ token, version: { protocolVersion: 1 } });
  await app.listen("127.0.0.1", 0);
  t.after(async () => { await app.close(); rmSync(root, { recursive: true, force: true }); });
  const base = `http://127.0.0.1:${app.address().port}`;
  const send = createAgentClient({ baseUrl: base, token }).fetch;
  const routes = createRemoteSessionRoutes(send);
  const auth = { authorization: `Bearer ${token}` };
  const session = { params: Promise.resolve({ id }) };
  const entry = { params: Promise.resolve({ id, entryId: assistantId }) };
  const cases = [
    ["/internal/v1/api/sessions?force=1", () => routes.LIST(new Request("http://web/api/sessions?force=1"))],
    [`/internal/v1/api/sessions/${id}?tail=1&deferThinking=1`, () => routes.DETAIL(new Request(`http://web/api/sessions/${id}?tail=1&deferThinking=1`), session)],
    [`/internal/v1/api/sessions/${id}/context?tail=1`, () => routes.CONTEXT(new Request(`http://web/api/sessions/${id}/context?tail=1`), session)],
    [`/internal/v1/api/sessions/${id}/state`, () => routes.STATE(new Request(`http://web/api/sessions/${id}/state`), session)],
    [`/internal/v1/api/sessions/${id}/entries/${assistantId}/thinking?blockIndex=0`, () => routes.THINKING(new Request(`http://web/api/sessions/${id}/entries/${assistantId}/thinking?blockIndex=0`), entry)],
  ];
  for (const [path, throughBff] of cases) {
    const expected = await bytes(await fetch(base + path, { headers: auth }));
    const actual = await bytes(await throughBff());
    assert.deepEqual(actual, expected, path);
  }
});
