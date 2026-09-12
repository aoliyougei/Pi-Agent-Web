import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { createAgentServer } from "../dist/server.js";
import { allowFileRoot } from "../dist/dependencies/allowed-roots.js";
import { acquireSessionLock } from "../dist/runtime/session-lock.js";
import { sessionFilesUnderWorktree } from "../dist/routes/worktrees.js";

const agentDir = mkdtempSync(join(tmpdir(), "pi-git-agent-"));
process.env.PI_CODING_AGENT_DIR = agentDir;
const { SessionManager } = await import("@earendil-works/pi-coding-agent");
test.after(() => rmSync(agentDir, { recursive: true, force: true }));

const token = "git-worktree-token";

function git(cwd, ...args) {
  return execFileSync("git", ["-C", cwd, ...args], { encoding: "utf8", env: { ...process.env, LC_ALL: "C" } }).trim();
}

function repository(t) {
  const parent = mkdtempSync(join(tmpdir(), "pi-git-route-"));
  const root = join(parent, "repo");
  execFileSync("git", ["init", "-q", "-b", "main", root]);
  git(root, "config", "user.name", "Pi Test");
  git(root, "config", "user.email", "pi@example.invalid");
  writeFileSync(join(root, "old.txt"), "old\n");
  writeFileSync(join(root, "changed.txt"), "before\n");
  git(root, "add", ".");
  git(root, "commit", "-qm", "initial");
  allowFileRoot(root);
  t.after(() => rmSync(parent, { recursive: true, force: true }));
  t.after(() => rmSync(`${root}-worktrees`, { recursive: true, force: true }));
  return root;
}

async function start(t) {
  const app = createAgentServer({ token, version: { protocolVersion: 1 } });
  await app.listen("127.0.0.1", 0);
  t.after(() => app.close());
  return `http://127.0.0.1:${app.address().port}`;
}

async function request(base, path, init = {}) {
  const response = await fetch(base + path, {
    ...init,
    headers: { authorization: `Bearer ${token}`, ...(init.body ? { "content-type": "application/json" } : {}), ...init.headers },
  });
  return { status: response.status, body: await response.json() };
}

test("Git subprocesses use fixed argv with time and output bounds", async () => {
  const gitChanges = await readFile(new URL("../src/dependencies/git-changes.ts", import.meta.url), "utf8");
  const worktree = await readFile(new URL("../src/dependencies/worktree.ts", import.meta.url), "utf8");
  for (const source of [gitChanges, worktree]) {
    assert.match(source, /execFileAsync\("git", \["-C", cwd, \.\.\.args\]/);
    assert.match(source, /timeout: (?:GIT_TIMEOUT_MS|10_000)/);
    assert.match(source, /maxBuffer/);
    assert.doesNotMatch(source, /\bexec\(/);
  }
});

test("worktree lock selection includes nested live Sessions and rejects transient ones", () => {
  assert.deepEqual(sessionFilesUnderWorktree("/repo/worktree", [
    { cwd: "/repo/worktree", path: "/sessions/a.jsonl" },
    { cwd: "/repo/worktree/nested", path: "/sessions/b.jsonl" },
    { cwd: "/repo/worktree-other", path: "/sessions/c.jsonl" },
    { cwd: "/repo/worktree", path: "/sessions/a.jsonl" },
  ]), ["/sessions/a.jsonl", "/sessions/b.jsonl"]);
  assert.throws(
    () => sessionFilesUnderWorktree("/repo/worktree", [{ cwd: "/repo/worktree", path: "" }]),
    (error) => error.code === "session_locked",
  );
});

test("worktree lock selection resolves symlinked Session cwds", (t) => {
  const parent = mkdtempSync(join(tmpdir(), "pi-worktree-symlink-"));
  const worktree = join(parent, "worktree");
  const nested = join(worktree, "nested");
  const alias = join(parent, "alias");
  mkdirSync(nested, { recursive: true });
  symlinkSync(nested, alias, "dir");
  t.after(() => rmSync(parent, { recursive: true, force: true }));

  assert.deepEqual(
    sessionFilesUnderWorktree(worktree, [{ cwd: alias, path: "/sessions/linked.jsonl" }]),
    ["/sessions/linked.jsonl"],
  );
});

test("internal Git status and diff preserve rename and patch semantics", async (t) => {
  const root = repository(t);
  git(root, "mv", "old.txt", "renamed.txt");
  writeFileSync(join(root, "changed.txt"), "after\n");
  writeFileSync(join(root, "new.txt"), "one\ntwo\n");
  const base = await start(t);
  const cwd = encodeURIComponent(root);

  const status = await request(base, `/internal/v1/api/git/status?cwd=${cwd}`);
  assert.equal(status.status, 200);
  assert.equal(status.body.isGitRepository, true);
  assert.equal(status.body.repositoryRoot, root);
  assert.deepEqual(status.body.files.map(({ status, filePath }) => [status, filePath.split("/").at(-1)]), [
    ["modified", "changed.txt"], ["renamed", "renamed.txt"], ["untracked", "new.txt"],
  ]);
  assert.equal(status.body.additions, 3);
  assert.equal(status.body.deletions, 1);

  const diff = await request(base, `/internal/v1/api/git/diff?cwd=${cwd}&path=${encodeURIComponent(join(root, "new.txt"))}`);
  assert.equal(diff.status, 200);
  assert.equal(diff.body.supported, true);
  assert.equal(diff.body.status, "untracked");
  assert.match(diff.body.patch, /\+one\n\+two/);
  assert.equal((await request(base, `/internal/v1/api/git/diff?cwd=${cwd}&path=${encodeURIComponent(join(root, "..", "escape.txt"))}`)).status, 403);
});

test("worktree removal honors Sessions rooted below the target path", async (t) => {
  const root = repository(t);
  const linked = join(`${root}-worktrees`, "locked");
  git(root, "worktree", "add", "-b", "feature/locked", "--", linked);
  const nested = join(linked, "nested");
  mkdirSync(nested);
  const managers = [SessionManager.create(nested), SessionManager.create(nested)];
  const sessionFiles = managers.map((manager) => {
    const sessionFile = manager.getSessionFile();
    mkdirSync(dirname(sessionFile), { recursive: true });
    writeFileSync(sessionFile, [manager.getHeader(), ...manager.getEntries()].map((entry) => JSON.stringify(entry)).join("\n") + "\n");
    return sessionFile;
  }).sort();
  const lockDirectory = join(agentDir, "locks", "sessions");
  const lease = acquireSessionLock(sessionFiles[1], lockDirectory, "test-owner");
  t.after(() => lease.release());
  const base = await start(t);

  const result = await request(base, "/internal/v1/api/worktrees", { method: "DELETE", body: JSON.stringify({ cwd: root, path: linked, force: true }) });
  assert.equal(result.status, 409);
  assert.equal(result.body.code, "session_locked");
  assert.equal(existsSync(linked), true);
  const released = acquireSessionLock(sessionFiles[0], lockDirectory, "post-conflict-check");
  released.release();
});

test("internal worktrees reuse branches and require force for dirty removal", async (t) => {
  const root = repository(t);
  git(root, "branch", "feature/existing");
  const base = await start(t);
  let result = await request(base, `/internal/v1/api/worktrees?cwd=${encodeURIComponent(root)}`);
  assert.equal(result.status, 200);
  assert.equal(result.body.isGit, true);
  assert.equal(result.body.currentWorktreePath, root);
  assert.equal(result.body.worktrees.length, 1);

  assert.deepEqual(
    await request(base, "/internal/v1/api/worktrees", { method: "POST", body: JSON.stringify({ cwd: root, branch: "" }) }),
    { status: 400, body: { error: "branch is required" } },
  );
  assert.deepEqual(
    await request(base, "/internal/v1/api/worktrees", { method: "DELETE", body: JSON.stringify({ cwd: root, path: root }) }),
    { status: 400, body: { error: "Cannot remove the main worktree", dirty: false } },
  );

  result = await request(base, "/internal/v1/api/worktrees", { method: "POST", body: JSON.stringify({ cwd: root, branch: "feature/existing" }) });
  assert.equal(result.status, 200);
  assert.equal(result.body.branch, "feature/existing");
  assert.equal(existsSync(result.body.path), true);
  const linked = result.body.path;
  writeFileSync(join(linked, "dirty.txt"), "dirty");

  const remove = { cwd: root, path: linked };
  result = await request(base, "/internal/v1/api/worktrees", { method: "DELETE", body: JSON.stringify(remove) });
  assert.equal(result.status, 409);
  assert.equal(result.body.dirty, true);
  assert.equal(existsSync(linked), true);

  result = await request(base, "/internal/v1/api/worktrees", { method: "DELETE", body: JSON.stringify({ ...remove, force: true }) });
  assert.deepEqual(result, { status: 200, body: { success: true } });
  assert.equal(existsSync(linked), false);
});
