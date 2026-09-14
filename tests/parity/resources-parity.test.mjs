import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createJiti } from "jiti";

const root = mkdtempSync(join(tmpdir(), "pi-resources-parity-"));
process.env.PI_CODING_AGENT_DIR = join(root, "agent");
mkdirSync(join(process.env.PI_CODING_AGENT_DIR, "skills", "parity-skill"), { recursive: true });
writeFileSync(join(process.env.PI_CODING_AGENT_DIR, "skills", "parity-skill", "SKILL.md"), "---\nname: parity-skill\ndescription: Parity fixture\n---\nBody\n");
const cwd = join(root, "project");
mkdirSync(cwd, { recursive: true });

const { createAgentServer } = await import("../../packages/pi-web-agent-server/dist/server.js");
const { allowFileRoot } = await import("../../packages/pi-web-agent-server/dist/dependencies/allowed-roots.js");
const jiti = createJiti(import.meta.url);
const { createAgentClient } = await jiti.import("../../lib/agent-rpc/client.ts");
const { createRemoteResourceRoutes } = await jiti.import("../../lib/agent-rpc/routes/resources.ts");
const token = "resources-parity-token";

async function snapshot(response) {
  return {
    status: response.status,
    type: response.headers.get("content-type"),
    body: new Uint8Array(await response.arrayBuffer()),
  };
}

test("resource BFF responses equal authenticated Agent responses byte-for-byte", async (t) => {
  allowFileRoot(cwd);
  const app = createAgentServer({ token, version: { protocolVersion: 1 } });
  await app.listen("127.0.0.1", 0);
  t.after(async () => { await app.close(); rmSync(root, { recursive: true, force: true }); });
  const base = `http://127.0.0.1:${app.address().port}`;
  const routes = createRemoteResourceRoutes(createAgentClient({ baseUrl: base, token }).fetch);
  const auth = { authorization: `Bearer ${token}` };
  const encoded = encodeURIComponent(cwd);
  const cases = [
    [`/internal/v1/api/skills?cwd=${encoded}`, () => routes.SKILLS(new Request(`http://web/api/skills?cwd=${encoded}`))],
    [`/internal/v1/api/plugins?cwd=${encoded}`, () => routes.PLUGINS(new Request(`http://web/api/plugins?cwd=${encoded}`))],
    ["/internal/v1/api/tools/settings", () => routes.TOOLS_SETTINGS(new Request("http://web/api/tools/settings"))],
    ["/internal/v1/api/subagents/settings", () => routes.SUBAGENT_SETTINGS(new Request("http://web/api/subagents/settings"))],
    [`/internal/v1/api/subagents/profiles?cwd=${encoded}`, () => routes.SUBAGENT_PROFILES(new Request(`http://web/api/subagents/profiles?cwd=${encoded}`))],
    [`/internal/v1/api/project-trust?cwd=${encoded}`, () => routes.PROJECT_TRUST(new Request(`http://web/api/project-trust?cwd=${encoded}`))],
  ];
  for (const [path, throughBff] of cases) {
    assert.deepEqual(await snapshot(await throughBff()), await snapshot(await fetch(base + path, { headers: auth })), path);
  }

  const payload = JSON.stringify({ cwd, scope: "project", profile: {
    name: "parity-agent", displayName: "Parity agent", description: "Parity fixture",
    systemPrompt: "Return parity.", tools: [], loadSkills: false, loadExtensions: false,
    inheritContext: false, runInBackground: false, enabled: true,
  } });
  const direct = await snapshot(await fetch(base + "/internal/v1/api/subagents/profiles", {
    method: "PUT", headers: { ...auth, "content-type": "application/json" }, body: payload,
  }));
  rmSync(join(cwd, ".pi"), { recursive: true, force: true });
  const proxied = await snapshot(await routes.SUBAGENT_PROFILES(new Request("http://web/api/subagents/profiles", {
    method: "PUT", headers: { "content-type": "application/json" }, body: payload,
  })));
  assert.deepEqual(proxied, direct);
});
