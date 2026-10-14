import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { chmod, chown, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import test from "node:test";
import { load as loadYaml } from "js-yaml";

const exec = promisify(execFile);
const root = new URL("../", import.meta.url).pathname;
const composePath = join(root, "deploy/compose/docker-compose.yml");
const checkerPath = join(root, "deploy/compose/check-secret.mjs");

function mounts(service) {
  return (service.volumes ?? []).map((volume) => typeof volume === "string" ? volume : `${volume.source}:${volume.target}`);
}

function secret(service) {
  return (service.secrets ?? []).find((entry) => typeof entry === "object" && entry.target === "pi-agent-rpc-token");
}

test("Compose exposes only Web and keeps Agent data on the internal service", async () => {
  const source = await readFile(composePath, "utf8");
  const compose = loadYaml(source);
  assert.deepEqual(Object.keys(compose.services).sort(), ["agent", "web"]);
  const { agent, web } = compose.services;
  assert.equal(agent.image, "pi-agent-rpc:0.1.0");
  assert.equal(web.image, "registry.aoliyougei.com/aoliyougei/pi-agent-web:0.2.0");
  assert.deepEqual(agent.expose, [8080]);
  assert.equal(agent.ports, undefined);
  assert.deepEqual(web.ports, ["${PI_AGENT_WEB_PORT:-30141}:30141"]);
  assert.deepEqual(mounts(agent), ["./data/workspace:/app", "./data/pi:/home/node/.pi"]);
  assert.deepEqual(mounts(web), ["web-config:/var/lib/pi-agent-web"]);
  assert.equal(web.environment.PI_WEB_CONFIG_DIR, "/var/lib/pi-agent-web/backends");
  assert.deepEqual(agent.networks.sort(), ["agent-egress", "agent-rpc"]);
  assert.deepEqual(web.networks, ["agent-rpc", "web-egress"]);
  assert.equal(compose.networks["agent-rpc"].internal, true);
  assert.equal(web.depends_on, undefined);
  assert.equal(agent.restart, "unless-stopped");
  assert.equal(web.restart, "unless-stopped");
  for (const service of [agent, web]) {
    assert.equal(service.user, "1000:1000");
    assert.deepEqual(service.cap_drop, ["ALL"]);
    assert.deepEqual(service.security_opt, ["no-new-privileges:true"]);
    assert.deepEqual(secret(service), { source: "rpc-token", target: "pi-agent-rpc-token", uid: "1000", gid: "1000", mode: 400 });
    const environment = service.environment ?? {};
    assert.equal(Object.keys(environment).some((name) => /(?:^|_)TOKEN$/.test(name)), false);
  }
  assert.equal((source.match(/^\s+mode: 0400$/gm) ?? []).length, 2);
  assert.deepEqual(compose.secrets["rpc-token"], { file: "./secrets/pi-agent-rpc-token" });
  assert.equal(web.environment.PI_AGENT_RPC_URL, "http://agent:8080");
  assert.equal(web.environment.PI_AGENT_RPC_TOKEN_FILE, "/run/secrets/pi-agent-rpc-token");
  assert.equal(agent.environment.PI_AGENT_RPC_TOKEN_FILE, "/run/secrets/pi-agent-rpc-token");
});

test("Compose setup and E2E preserve non-root ownership and clean task resources", async () => {
  const readme = await readFile(join(root, "deploy/compose/README.md"), "utf8");
  assert.match(readme, /chown -R 1000:1000 data/);
  assert.ok(readme.indexOf("node check-secret.mjs") < readme.indexOf("docker compose up -d"));
  const e2e = await readFile(join(root, "tests/compose-e2e.sh"), "utf8");
  assert.match(e2e, /PROJECT=.*\$\$/);
  assert.match(e2e, /trap cleanup EXIT/);
  assert.match(e2e, /\$COMPOSE down/);
  assert.match(e2e, /docker port "\$agent_id"/);
  assert.match(e2e, /PI_AGENT_WEB_PORT=/);
  for (const path of ["\/api\/health\/live", "\/api\/health\/ready", "\/api\/agent\/running", "\/api\/sessions"]) assert.match(e2e, new RegExp(path));
});

test("Compose Secret checker accepts only a regular UID 1000 mode 0400 file", async (t) => {
  if (process.getuid?.() !== 0) return t.skip("requires root to construct ownership fixtures");
  const directory = await mkdtemp(join(tmpdir(), "pi-compose-secret-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const path = join(directory, "token");
  await writeFile(path, "test-token\n");
  await chown(path, 1000, 1000);
  await chmod(path, 0o400);
  await exec(process.execPath, [checkerPath, path]);

  await chmod(path, 0o440);
  await assert.rejects(exec(process.execPath, [checkerPath, path]), /Invalid RPC token file/);
  await chmod(path, 0o400);
  await chown(path, 0, 0);
  await assert.rejects(exec(process.execPath, [checkerPath, path]), /Invalid RPC token file/);

  const link = join(directory, "link");
  await symlink(path, link);
  await assert.rejects(exec(process.execPath, [checkerPath, link]), /Invalid RPC token file/);
});
