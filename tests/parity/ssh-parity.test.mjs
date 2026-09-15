import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const { createAgentServer } = await import("../../packages/pi-web-agent-server/dist/server.js");
const jiti = createJiti(import.meta.url);
const { createAgentClient } = await jiti.import("../../lib/agent-rpc/client.ts");
const { createRemoteSshRoutes } = await jiti.import("../../lib/agent-rpc/routes/ssh.ts");
const token = "ssh-parity-token";
const id = "ssh-parity";
const context = { params: Promise.resolve({ id }) };
const entry = { type: "custom", customType: "pi-ssh-remote-state", data: { version: 2, target: "devbox", remotePlatform: "unix", remoteShell: "bash", remoteCwd: "/srv/app", remoteHome: "/home/dev" } };

async function snapshot(response) {
  return {
    status: response.status,
    type: response.headers.get("content-type"),
    body: new Uint8Array(await response.arrayBuffer()),
  };
}

function installRuntime() {
  globalThis.__piAgentServerSessions = new Map([[id, {
    isAlive: () => true,
    inner: {
      sessionManager: { getBranch: () => [entry], getCwd: () => "/local/anchor" },
      extensionRunner: { hasHandlers: (name) => name === "user_bash", getToolDefinition: (name) => name === "ls"
        ? { execute: async () => ({ content: [{ type: "text", text: "a.ts\nsrc/" }] }) }
        : name === "read"
          ? { execute: async () => ({ content: [{ type: "text", text: "hello" }] }) }
          : undefined },
    },
  }]]);
}

test("SSH BFF responses equal authenticated Agent responses byte-for-byte", async (t) => {
  const previousRegistry = globalThis.__piAgentServerSessions;
  installRuntime();
  const app = createAgentServer({ token, version: { protocolVersion: 1 } });
  await app.listen("127.0.0.1", 0);
  t.after(async () => {
    await app.close();
    globalThis.__piAgentServerSessions = previousRegistry;
  });
  const base = `http://127.0.0.1:${app.address().port}`;
  const routes = createRemoteSshRoutes(createAgentClient({ baseUrl: base, token }).fetch);
  const auth = { authorization: `Bearer ${token}` };
  const cases = [
    [routes.ENVIRONMENT, `/api/sessions/${id}/ssh-environment`, `/internal/v1/api/sessions/${id}/ssh-environment`],
    [routes.FILES, `/api/agent/${id}/remote-files?path=src`, `/internal/v1/api/agent/${id}/remote-files?path=src`],
    [routes.FILE, `/api/agent/${id}/remote-file?path=a.ts`, `/internal/v1/api/agent/${id}/remote-file?path=a.ts`],
  ];
  for (const [handler, browserPath, agentPath] of cases) {
    const browser = await snapshot(await handler(new Request(`http://web${browserPath}`), context));
    const agent = await snapshot(await fetch(base + agentPath, { headers: auth }));
    assert.equal(browser.status, 200);
    assert.deepEqual(browser, agent);
  }
});
