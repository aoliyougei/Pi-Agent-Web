import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { acquireSessionLock } from "../dist/runtime/session-lock.js";

const cli = join(dirname(fileURLToPath(import.meta.resolve("@earendil-works/pi-coding-agent"))), "cli.js");
const preload = fileURLToPath(new URL("../dist/runtime/cli-preload.js", import.meta.url));
function fixture(t) {
  const dir = mkdtempSync(join(tmpdir(), "pi-cli-lock-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const file = join(dir, "session.jsonl");
  const bytes = JSON.stringify({ type: "session", version: 3, id: "test", timestamp: new Date().toISOString(), cwd: dir }) + "\n";
  writeFileSync(file, bytes);
  return { dir, file, bytes, locks: join(dir, "agent", "locks", "sessions"), env: { ...process.env, PI_CODING_AGENT_DIR: join(dir, "agent"), HOME: dir } };
}

test("original CLI with preload refuses an RPC-held session without modifying its bytes", (t) => {
  const { dir, file, bytes, locks, env } = fixture(t);
  const lease = acquireSessionLock(file, locks, "rpc");
  t.after(() => lease.release());
  for (const args of [["--session", file], ["--continue", "--session-dir", dir]]) {
    const result = spawnSync(process.execPath, ["--import", preload, cli, "--mode", "rpc", "--no-extensions", ...args], { cwd: dir, env, encoding: "utf8", timeout: 20000 });
    assert.equal(result.error, undefined);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr + result.stdout, /Session is already owned/);
    assert.equal(readFileSync(file, "utf8"), bytes);
  }
});

test("real CLI owns its session while serving commands and SIGKILL releases the lease", { timeout: 25000 }, async (t) => {
  const { dir, file, locks, env } = fixture(t);
  const child = spawn(process.execPath, ["--import", preload, cli, "--mode", "rpc", "--no-extensions", "--session", file], { cwd: dir, env, stdio: ["pipe", "pipe", "pipe"] });
  t.after(async () => {
    if (child.exitCode === null && child.signalCode === null) { const exit = once(child, "exit"); child.kill("SIGKILL"); await exit; }
  });
  let output = "", errors = "";
  child.stderr.on("data", (chunk) => { errors += chunk; });
  const ready = new Promise((resolve, reject) => {
    child.stdout.on("data", (chunk) => { output += chunk; if (output.includes('"command":"get_state"')) resolve(); });
    child.once("exit", (code) => reject(new Error(`CLI exited ${code}: ${errors}`)));
  });
  child.stdin.write('{"type":"get_state","id":"check"}\n');
  await ready;
  assert.match(output, /"success":true/);
  assert.throws(() => acquireSessionLock(file, locks, "rpc"), { code: "session_locked" });
  acquireSessionLock(join(dir, "other.jsonl"), locks, "rpc").release();
  const command = (type, id, extra = {}) => new Promise((resolve, reject) => {
    let text = "";
    const onData = (chunk) => {
      text += chunk;
      const lines = text.split("\n");
      text = lines.pop();
      for (const line of lines) {
        if (!line.trim()) continue;
        const event = JSON.parse(line);
        if (event.type === "response" && event.id === id) { cleanup(); resolve(event); }
      }
    };
    const onExit = () => { cleanup(); reject(new Error(`CLI exited: ${errors}`)); };
    const cleanup = () => { child.stdout.off("data", onData); child.off("exit", onExit); };
    child.stdout.on("data", onData);
    child.once("exit", onExit);
    child.stdin.write(JSON.stringify({ type, id, ...extra }) + "\n");
  });
  assert.equal((await command("new_session", "new")).success, true);
  const state = await command("get_state", "after-new");
  const next = state.data.sessionFile;
  assert.ok(next);
  assert.notEqual(next, file);
  acquireSessionLock(file, locks, "rpc").release();
  assert.throws(() => acquireSessionLock(next, locks, "rpc"), { code: "session_locked" });
  const other = acquireSessionLock(file, locks, "rpc");
  try { assert.equal((await command("switch_session", "blocked-switch", { sessionPath: file })).success, false); }
  finally { other.release(); }
  assert.equal((await command("get_state", "still-new")).data.sessionFile, next);
  assert.throws(() => acquireSessionLock(next, locks, "rpc"), { code: "session_locked" });
  assert.equal((await command("switch_session", "switch-back", { sessionPath: file })).success, true);
  acquireSessionLock(next, locks, "rpc").release();
  assert.throws(() => acquireSessionLock(file, locks, "rpc"), { code: "session_locked" });
  const exit = once(child, "exit");
  child.kill("SIGKILL");
  await exit;
  acquireSessionLock(file, locks, "rpc").release();
});
