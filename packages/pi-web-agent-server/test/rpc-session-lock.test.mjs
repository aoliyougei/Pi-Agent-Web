import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const dir = mkdtempSync(join(tmpdir(), "pi-rpc-lease-"));
process.env.PI_CODING_AGENT_DIR = join(dir, "agent");
const { SessionManager } = await import("@earendil-works/pi-coding-agent");
const { createAgentServer } = await import("../dist/server.js");
const { createAgentRouteAdapter } = await import("../dist/runtime/agent-adapter.js");
const { startRpcSession, destroyRpcSessionsForCwd } = await import("../dist/runtime/session-runtime.js");
const { acquireSessionLock } = await import("../dist/runtime/session-lock.js");
const cli = join(dirname(fileURLToPath(import.meta.resolve("@earendil-works/pi-coding-agent"))), "cli.js");
const preload = fileURLToPath(new URL("../dist/runtime/cli-preload.js", import.meta.url));

async function startCli(t, file) {
  const child = spawn(process.execPath, ["--import", preload, cli, "--mode", "rpc", "--no-extensions", "--session", file], { cwd: dir, env: process.env, stdio: ["pipe", "pipe", "pipe"] });
  t.after(async () => { if (child.exitCode === null && child.signalCode === null) { const exit = once(child, "exit"); child.kill("SIGKILL"); await exit; } });
  let errors = "", output = "";
  child.stderr.on("data", (chunk) => { errors += chunk; });
  await new Promise((resolve, reject) => {
    child.once("exit", () => reject(new Error(errors)));
    child.stdout.on("data", (chunk) => { output += chunk; if (output.includes('"command":"get_state"')) resolve(); });
    child.stdin.write('{"type":"get_state"}\n');
  });
  return child;
}

test("real CLI ownership produces HTTP 409; RPC owns the same file after CLI exit and releases on shutdown", { timeout: 30000 }, async (t) => {
  t.after(async () => { await destroyRpcSessionsForCwd(dir); rmSync(dir, { recursive: true, force: true }); });
  const manager = SessionManager.create(dir);
  const file = manager.getSessionFile(), id = manager.getSessionId();
  writeFileSync(file, JSON.stringify(manager.getHeader()) + "\n");
  const child = await startCli(t, file);
  const app = createAgentServer({ token: "test", version: { protocolVersion: 1, serverVersion: "0.1.0", piVersion: "0.84.4", piRevision: "test", capabilities: [] }, agent: createAgentRouteAdapter() });
  await app.listen("127.0.0.1", 0);
  t.after(() => app.close());
  const response = await fetch(`http://127.0.0.1:${app.address().port}/internal/v1/api/agent/${id}`, { headers: { authorization: "Bearer test" } });
  assert.equal(response.status, 409);
  assert.equal((await response.json()).error.code, "session_locked");
  for (const suffix of ["events", "extension-ui/pending"]) {
    const conflict = await fetch(`http://127.0.0.1:${app.address().port}/internal/v1/api/agent/${id}/${suffix}`, { headers: { authorization: "Bearer test", "x-request-id": "conflict-check" } });
    assert.equal(conflict.status, 409);
    const error = (await conflict.json()).error;
    assert.equal(error.code, "session_locked");
    assert.equal(error.requestId, "conflict-check");
  }
  const exit = once(child, "exit"); child.kill("SIGKILL"); await exit;
  const { session } = await startRpcSession(id, file, undefined, { toolNames: [] });
  t.after(() => session.shutdown());
  const locks = join(dir, "agent", "locks", "sessions");
  assert.throws(() => acquireSessionLock(file, locks, "cli"), { code: "session_locked" });
  const blocked = spawnSync(process.execPath, ["--import", preload, cli, "--mode", "rpc", "--no-extensions", "--session", file], { cwd: dir, env: process.env, encoding: "utf8", timeout: 15000 });
  assert.equal(blocked.error, undefined);
  assert.notEqual(blocked.status, 0);
  assert.match(blocked.stderr + blocked.stdout, /Session is already owned/);
  await session.shutdown();
  const invalid = join(dir, "invalid.jsonl");
  writeFileSync(invalid, "not a session\n");
  await assert.rejects(startRpcSession("invalid", invalid, undefined));
  acquireSessionLock(invalid, locks, "cli").release();
  acquireSessionLock(file, locks, "cli").release();
});
