import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import test from "node:test";

const exec = promisify(execFile);
const root = resolve(new URL("..", import.meta.url).pathname);
const script = join(root, "scripts/package-agent-server.mjs");
const files = ["agent-contract-0.1.0.tgz", "pi-web-agent-server-0.1.0.tgz"];
const sha256 = (value) => createHash("sha256").update(value).digest("hex");

async function packageInto(path) {
  await exec(process.execPath, [script, path], { cwd: root });
  return Promise.all(files.map(async (file) => [file, await readFile(join(path, file))]));
}

test("packages deterministic minimal agent artifacts with an exact lock", async (t) => {
  const first = await mkdtemp(join(tmpdir(), "pi-agent-pack-1-"));
  const second = await mkdtemp(join(tmpdir(), "pi-agent-pack-2-"));
  t.after(() => Promise.all([rm(first, { recursive: true, force: true }), rm(second, { recursive: true, force: true })]));
  const firstFiles = await packageInto(first);
  const secondFiles = await packageInto(second);
  for (let index = 0; index < files.length; index++) {
    assert.equal(sha256(firstFiles[index][1]), sha256(secondFiles[index][1]), `${files[index]} is not deterministic`);
  }
  const lock = JSON.parse(await readFile(join(first, "bridge-package.lock.json"), "utf8"));
  assert.deepEqual(lock.pi, {
    version: "0.84.4",
    revision: "b79e4cc834970cca69daebffab7df1da7d1e52c4",
  });
  assert.deepEqual(lock.packages.map(({ name, version, file, compatiblePiVersion }) => ({ name, version, file, compatiblePiVersion })), [
    { name: "@aoliyougei/pi-agent-contract", version: "0.1.0", file: files[0], compatiblePiVersion: undefined },
    { name: "@aoliyougei/pi-web-agent-server", version: "0.1.0", file: files[1], compatiblePiVersion: "0.84.4" },
  ]);
  for (const item of lock.packages) {
    assert.equal(item.sha256, sha256(await readFile(join(first, item.file))));
  }
});

test("packed files contain only declared runtime output", async (t) => {
  const output = await mkdtemp(join(tmpdir(), "pi-agent-pack-content-"));
  t.after(() => rm(output, { recursive: true, force: true }));
  await packageInto(output);
  for (const file of files) {
    const { stdout } = await exec("tar", ["-tzf", join(output, file)]);
    const entries = stdout.trim().split("\n");
    assert.ok(entries.includes("package/package.json"));
    assert.ok(entries.some((entry) => entry.startsWith("package/dist/") && entry.endsWith(".js")));
    assert.ok(entries.every((entry) => entry === "package/package.json" || entry.startsWith("package/dist/")), entries.join("\n"));
    assert.ok(entries.every((entry) => !entry.endsWith(".map") && !entry.includes("test") && !entry.includes(".env") && !entry.includes("secret")));
  }
});
