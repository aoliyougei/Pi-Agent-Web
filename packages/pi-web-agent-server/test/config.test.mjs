import assert from "node:assert/strict";
import { chmod, chown, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { loadToken } from "../dist/config.js";

async function tokenFile(contents = "secret-token\n", mode = 0o400) {
  const dir = await mkdtemp(join(tmpdir(), "pi-agent-token-"));
  const path = join(dir, "token");
  await writeFile(path, contents, { mode });
  await chmod(path, mode);
  return { dir, path };
}

test("loads an owner-only token and trims one trailing newline", async (t) => {
  const fixture = await tokenFile();
  t.after(() => rm(fixture.dir, { recursive: true, force: true }));
  assert.equal(await loadToken(fixture.path, { uid: process.getuid(), gids: process.getgroups() }), "secret-token");
});

test("accepts a root-owned 0440 Kubernetes secret for runtime group 1000", async (t) => {
  if (process.getuid() !== 0) return t.skip("requires root to set fixture ownership");
  const fixture = await tokenFile("secret-token", 0o440);
  t.after(() => rm(fixture.dir, { recursive: true, force: true }));
  await chown(fixture.path, 0, 1000);
  assert.equal(await loadToken(fixture.path, { uid: 1000, gids: [1000] }), "secret-token");
});

test("rejects missing, empty, oversized, executable, and unsafe token files", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "pi-agent-token-invalid-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const cases = [
    ["empty", "\n", 0o400],
    ["oversized", "x".repeat(4097), 0o400],
    ["executable", "secret", 0o500],
    ["world-readable", "secret", 0o404],
    ["wrong-group", "secret", 0o440],
    ["owner-wrong-group", "secret", 0o440],
  ];
  await assert.rejects(() => loadToken(join(dir, "missing"), { uid: 1000, gids: [1000] }), /token file/i);
  for (const [name, contents, mode] of cases) {
    const path = join(dir, name);
    await writeFile(path, contents, { mode });
    await chmod(path, mode);
    if (process.getuid() === 0 && name === "wrong-group") await chown(path, 0, 2000);
    if (process.getuid() === 0 && name === "owner-wrong-group") await chown(path, 1000, 2000);
    await assert.rejects(() => loadToken(path, { uid: 1000, gids: [1000] }), /token file/i, name);
  }
});
