import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";

const root = mkdtempSync(join(tmpdir(), "pi-ssh-workspace-"));
process.env.PI_CODING_AGENT_DIR = join(root, "agent");
const { SessionManager } = await import("@earendil-works/pi-coding-agent");
const { createAgentServer } = await import("../dist/server.js");
const token = "ssh-workspace-token";

test("Agent Session listing exposes a distinct saved SSH workspace identity", async (t) => {
  const manager = SessionManager.create(root);
  manager.appendCustomEntry("pi-ssh-remote-state", {
    version: 2,
    target: "devbox",
    port: 2201,
    remotePlatform: "unix",
    remoteShell: "bash",
    remoteCwd: "/srv/project",
    remoteHome: "/home/dev",
  });
  mkdirSync(dirname(manager.getSessionFile()), { recursive: true });
  writeFileSync(manager.getSessionFile(), [manager.getHeader(), ...manager.getEntries()].map((value) => JSON.stringify(value)).join("\n") + "\n");

  const app = createAgentServer({ token, version: { protocolVersion: 1 } });
  await app.listen("127.0.0.1", 0);
  t.after(async () => { await app.close(); rmSync(root, { recursive: true, force: true }); });
  const base = `http://127.0.0.1:${app.address().port}`;
  const response = await fetch(`${base}/internal/v1/api/sessions?force=1`, { headers: { authorization: `Bearer ${token}` } });
  assert.equal(response.status, 200);
  const session = (await response.json()).sessions.find(({ id }) => id === manager.getSessionId());
  assert.equal(session.workspaceKind, "ssh");
  assert.equal(session.workspaceKey, "ssh:devbox:2201:/srv/project");
  assert.equal(session.workspaceLabel, "devbox:2201:/srv/project");
  assert.equal(session.cwd, root);
});
