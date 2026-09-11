import assert from "node:assert/strict";
import { once } from "node:events";
import { spawn, spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

const moduleUrl = new URL("../dist/runtime/session-lock.js", import.meta.url).href;

async function fixture(t) {
  const dir = mkdtempSync(join(tmpdir(), "pi-lease-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const file = join(dir, "session.jsonl");
  writeFileSync(file, "session data\n");
  const locks = join(dir, "locks");
  const subject = await import(moduleUrl);
  return { ...subject, dir, file, locks };
}

async function holder(t, file, locks, owner) {
  const child = spawn(process.execPath, ["--input-type=module", "-e", `
    import { acquireSessionLock } from ${JSON.stringify(moduleUrl)};
    const lease = acquireSessionLock(process.argv[1], process.argv[2], process.argv[3]);
    process.send({ path: lease.path });
    process.on('message', () => { lease.release(); process.exit(0); });
  `, file, locks, owner], { stdio: ["ignore", "ignore", "pipe", "ipc"] });
  t.after(async () => { if (child.exitCode === null && child.signalCode === null) { const exit = once(child, "exit"); child.kill("SIGKILL"); await exit; } });
  const [message] = await Promise.race([
    once(child, "message"),
    once(child, "exit").then(([code]) => { throw new Error(`lock holder exited ${code}`); }),
  ]);
  return { child, path: message.path };
}

for (const owner of ["rpc", "cli"]) {
  test(`${owner} kernel lease rejects another process, preserves reads, and releases on SIGKILL`, async (t) => {
    const { acquireSessionLock, file, locks, dir } = await fixture(t);
    const { child, path } = await holder(t, file, locks, owner);
    assert.equal(readFileSync(file, "utf8"), "session data\n");
    assert.equal(JSON.parse(readFileSync(path, "utf8")).owner, owner);
    // Metadata is not authority: even replacing its contents must not unlock the inode.
    writeFileSync(path, '{"pid":-1}');
    assert.throws(() => acquireSessionLock(file, locks, "contender"), { code: "session_locked" });
    assert.equal(spawnSync("flock", ["-n", path, "true"]).status, 1);
    const other = acquireSessionLock(join(dir, "different.jsonl"), locks, "other");
    other.release();
    const exit = once(child, "exit");
    child.kill("SIGKILL");
    await exit;
    const lease = acquireSessionLock(file, locks, "replacement");
    lease.release();
    lease.release();
    assert.equal(spawnSync("flock", ["-n", path, "true"]).status, 0);
  });
}

test("a shell flock owner blocks the Node adapter on the same inode", async (t) => {
  const { acquireSessionLock, file, locks } = await fixture(t);
  const lease = acquireSessionLock(file, locks, "setup");
  lease.release();
  const child = spawn("sh", ["-c", 'exec 9>"$1"; flock -n 9 || exit; printf ready; read release', "sh", lease.path], { stdio: ["pipe", "pipe", "pipe"] });
  t.after(() => child.kill("SIGKILL"));
  await Promise.race([
    once(child.stdout, "data"),
    once(child, "exit").then(([code]) => { throw new Error(`shell lock owner exited ${code}`); }),
  ]);
  assert.throws(() => acquireSessionLock(file, locks, "rpc"), { code: "session_locked" });
  const exit = once(child, "exit");
  child.stdin.end("release\n");
  await exit;
  acquireSessionLock(file, locks, "rpc").release();
});

test("canonical symlinks share a lock before the session file exists; normal exit releases it", async (t) => {
  const { acquireSessionLock, dir, locks } = await fixture(t);
  mkdirSync(join(dir, "real"));
  symlinkSync(join(dir, "real"), join(dir, "alias"));
  const { child } = await holder(t, join(dir, "real", "new.jsonl"), locks, "rpc");
  assert.throws(() => acquireSessionLock(join(dir, "alias", "new.jsonl"), locks, "cli"), { code: "session_locked" });
  const exit = once(child, "exit");
  child.send("release");
  await exit;
  acquireSessionLock(join(dir, "alias", "new.jsonl"), locks, "cli").release();
});
