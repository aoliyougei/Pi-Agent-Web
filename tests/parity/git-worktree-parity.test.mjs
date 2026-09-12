import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createJiti } from "jiti";
import { createAgentServer } from "../../packages/pi-web-agent-server/dist/server.js";
import { allowFileRoot } from "../../packages/pi-web-agent-server/dist/dependencies/allowed-roots.js";

const token = "git-parity-token";
const git = (cwd, ...args) => execFileSync("git", ["-C", cwd, ...args], { env: { ...process.env, LC_ALL: "C" } });

async function snapshot(response) {
  return {
    status: response.status,
    type: response.headers.get("content-type"),
    body: new Uint8Array(await response.arrayBuffer()),
  };
}

test("Git and worktree BFF responses equal authenticated Agent responses", async (t) => {
  const parent = mkdtempSync(join(tmpdir(), "pi-git-parity-"));
  const root = join(parent, "repo");
  execFileSync("git", ["init", "-q", "-b", "main", root]);
  git(root, "config", "user.name", "Pi Test");
  git(root, "config", "user.email", "pi@example.invalid");
  writeFileSync(join(root, "file.txt"), "before\n");
  git(root, "add", ".");
  git(root, "commit", "-qm", "initial");
  writeFileSync(join(root, "file.txt"), "after\n");
  allowFileRoot(root);

  const app = createAgentServer({ token, version: { protocolVersion: 1 } });
  await app.listen("127.0.0.1", 0);
  t.after(async () => { await app.close(); rmSync(parent, { recursive: true, force: true }); });
  const base = `http://127.0.0.1:${app.address().port}`;
  const jiti = createJiti(import.meta.url);
  const { createAgentClient } = await jiti.import("../../lib/agent-rpc/client.ts");
  const { createRemoteGitWorktreeRoutes } = await jiti.import("../../lib/agent-rpc/routes/git-worktrees.ts");
  const routes = createRemoteGitWorktreeRoutes(createAgentClient({ baseUrl: base, token }).fetch);
  const auth = { authorization: `Bearer ${token}` };
  const cwd = encodeURIComponent(root);
  const cases = [
    [`/internal/v1/api/git/status?cwd=${cwd}`, () => routes.STATUS(new Request(`http://web/api/git/status?cwd=${cwd}`))],
    [`/internal/v1/api/git/diff?cwd=${cwd}&path=${encodeURIComponent(join(root, "file.txt"))}`, () => routes.DIFF(new Request(`http://web/api/git/diff?cwd=${cwd}&path=${encodeURIComponent(join(root, "file.txt"))}`))],
    [`/internal/v1/api/worktrees?cwd=${cwd}`, () => routes.WORKTREES(new Request(`http://web/api/worktrees?cwd=${cwd}`))],
  ];
  for (const [path, throughBff] of cases) {
    assert.deepEqual(await snapshot(await throughBff()), await snapshot(await fetch(base + path, { headers: auth })), path);
  }
});
