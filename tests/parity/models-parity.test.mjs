import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createJiti } from "jiti";

const root = mkdtempSync(join(tmpdir(), "pi-models-parity-"));
process.env.PI_CODING_AGENT_DIR = join(root, "agent");
mkdirSync(process.env.PI_CODING_AGENT_DIR, { recursive: true });
const secret = "parity-agent-only-secret";
writeFileSync(join(process.env.PI_CODING_AGENT_DIR, "models.json"), JSON.stringify({ providers: { parity: {
  baseUrl: "http://127.0.0.1:9", api: "openai-completions", apiKey: secret,
  models: [{ id: "parity-model", name: "Parity Model", contextWindow: 4096, maxTokens: 256 }],
} } }), { mode: 0o600 });

const { createAgentServer } = await import("../../packages/pi-web-agent-server/dist/server.js");
const { allowFileRoot } = await import("../../packages/pi-web-agent-server/dist/dependencies/allowed-roots.js");
const jiti = createJiti(import.meta.url);
const { createAgentClient } = await jiti.import("../../lib/agent-rpc/client.ts");
const { createRemoteModelsAuthRoutes } = await jiti.import("../../lib/agent-rpc/routes/models-auth.ts");
const token = "models-parity-token";

async function snapshot(response) {
  return {
    status: response.status,
    type: response.headers.get("content-type"),
    body: new Uint8Array(await response.arrayBuffer()),
  };
}

test("model/config/provider BFF responses equal authenticated Agent responses without leaking keys", async (t) => {
  allowFileRoot(root);
  const app = createAgentServer({ token, version: { protocolVersion: 1 } });
  await app.listen("127.0.0.1", 0);
  t.after(async () => { await app.close(); rmSync(root, { recursive: true, force: true }); });
  const base = `http://127.0.0.1:${app.address().port}`;
  const routes = createRemoteModelsAuthRoutes(createAgentClient({ baseUrl: base, token }).fetch);
  const auth = { authorization: `Bearer ${token}` };
  const cwd = encodeURIComponent(root);
  const cases = [
    [`/internal/v1/api/models?cwd=${cwd}`, () => routes.MODELS(new Request(`http://web/api/models?cwd=${cwd}`))],
    ["/internal/v1/api/models-config", () => routes.MODELS_CONFIG(new Request("http://web/api/models-config"))],
    ["/internal/v1/api/auth/providers", () => routes.PROVIDERS(new Request("http://web/api/auth/providers"))],
  ];
  for (const [path, throughBff] of cases) {
    const expected = await snapshot(await fetch(base + path, { headers: auth }));
    const actual = await snapshot(await throughBff());
    assert.deepEqual(actual, expected, path);
    assert.equal(new TextDecoder().decode(actual.body).includes(secret), false, path);
  }
});
