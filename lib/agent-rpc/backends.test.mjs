import assert from "node:assert/strict";
import { mkdtemp, rm, stat, symlink, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createJiti } from "jiti";
const jiti = createJiti(import.meta.url);

test("private shared backend CRUD redacts tokens and preserves blank edits", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "web-backends-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  process.env.PI_WEB_CONFIG_DIR = join(dir, "config");
  const { listBackends, saveBackend, getBackend, deleteBackend } = await jiti.import("./backends.ts");
  const backend = await saveBackend({ name: "Office", baseUrl: "https://agent.example:8443", token: "test-secret" });
  assert.equal(backend.hasToken, true);
  assert.equal(backend.token, undefined);
  assert.equal((await getBackend(backend.id)).token, "test-secret");
  await saveBackend({ id: backend.id, name: "Office 2", baseUrl: "http://agent.example:8080", token: "" });
  const list = await listBackends();
  assert.equal(list.find((item) => item.id === backend.id).name, "Office 2");
  assert.ok(!JSON.stringify(list).includes("test-secret"));
  assert.equal((await getBackend(backend.id)).token, "test-secret");
  assert.equal((await stat(process.env.PI_WEB_CONFIG_DIR)).mode & 0o777, 0o700);
  assert.equal((await stat(join(process.env.PI_WEB_CONFIG_DIR, `${backend.id}.json`))).mode & 0o777, 0o600);
  await deleteBackend(backend.id);
  await assert.rejects(getBackend(backend.id), /Backend not found/);
  await assert.rejects(getBackend("../outside"), /Invalid backend id/);
});

test("default profile can be overridden and deleted without fallback", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "web-default-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  process.env.PI_WEB_CONFIG_DIR = dir;
  const { listBackends, saveBackend, getBackend, deleteBackend } = await jiti.import("./backends.ts");
  delete process.env.PI_AGENT_RPC_URL;
  assert.deepEqual(await listBackends(), []);
  await assert.rejects(getBackend("default"), /Backend not found/);
  process.env.PI_AGENT_RPC_URL = "http://pi-agent-rpc:8080";
  assert.equal((await listBackends()).find((item) => item.id === "default").baseUrl, "http://pi-agent-rpc:8080");
  delete process.env.PI_AGENT_RPC_URL;
  await saveBackend({ id: "default", name: "Primary", baseUrl: "https://agent.example", token: "override-secret" });
  assert.equal((await getBackend("default")).token, "override-secret");
  await deleteBackend("default");
  assert.deepEqual(await listBackends(), []);
  await assert.rejects(getBackend("default"), /Backend not found/);
});

test("validates profile inputs and refuses symlinked config files", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "web-validation-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  process.env.PI_WEB_CONFIG_DIR = dir;
  const { saveBackend, getBackend } = await jiti.import("./backends.ts");
  for (const baseUrl of ["file:///tmp/x", "http://user:pass@host", "http://host/path", "http://host/?x=1", "http://host/#x"]) {
    await assert.rejects(saveBackend({ name: "Bad", baseUrl, token: "secret" }), /Invalid backend URL/);
  }
  for (const token of ["", "bad\r\nheader", "x".repeat(4097)]) {
    await assert.rejects(saveBackend({ name: "Bad", baseUrl: "http://host", token }), /Invalid backend token/);
  }
  await assert.rejects(saveBackend({ name: " ", baseUrl: "http://host", token: "secret" }), /Invalid backend name/);
  const profile = await saveBackend({ name: "Valid", baseUrl: "http://host", token: "secret" });
  const path = join(dir, `${profile.id}.json`);
  const data = await readFile(path, "utf8");
  await rm(path);
  await symlink(join(dir, "outside"), path);
  await assert.rejects(getBackend(profile.id));
  assert.ok(data.includes('"token"'));
});
