import assert from "node:assert/strict";
import { lstatSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import test from "node:test";

const agentDir = mkdtempSync(join(tmpdir(), "pi-resources-agent-"));
process.env.PI_CODING_AGENT_DIR = agentDir;
const { createAgentServer } = await import("../dist/server.js");
const { allowFileRoot } = await import("../dist/dependencies/allowed-roots.js");
const token = "resources-token";
test.after(() => rmSync(agentDir, { recursive: true, force: true }));

async function start(t, resources) {
  const app = createAgentServer({ token, version: { protocolVersion: 1 }, resources });
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

const json = (method, value) => ({ method, body: JSON.stringify(value) });
const rawJson = (method, value) => ({ method, body: value });
const profile = (name = "route-agent") => ({
  name,
  displayName: "Route agent",
  description: "Route fixture",
  systemPrompt: "Return a concise result.",
  tools: [],
  loadSkills: true,
  loadExtensions: false,
  inheritContext: false,
  runInBackground: true,
  enabled: true,
});

test("Agent owns tool and subagent settings persistence", async (t) => {
  const base = await start(t);
  assert.deepEqual(await request(base, "/internal/v1/api/tools/settings"), {
    status: 200,
    body: { isWindows: false, powerShellEnabled: false },
  });
  assert.deepEqual(await request(base, "/internal/v1/api/tools/settings", json("PUT", { enabled: true })), {
    status: 404,
    body: { error: "PowerShell tool settings are only available on Windows" },
  });

  assert.deepEqual(await request(base, "/internal/v1/api/subagents/settings"), {
    status: 200,
    body: { enabled: false },
  });
  assert.deepEqual(await request(base, "/internal/v1/api/subagents/settings", json("PUT", { enabled: true })), {
    status: 200,
    body: { enabled: true },
  });
  assert.deepEqual(await request(base, "/internal/v1/api/subagents/settings", json("PUT", { enabled: "yes" })), {
    status: 400,
    body: { error: "enabled must be a boolean" },
  });
  const settingsPath = join(agentDir, "agents", "settings.json");
  assert.deepEqual(JSON.parse(readFileSync(settingsPath, "utf8")), { version: 1, builtInEnabled: true });
  if (process.platform !== "win32") assert.equal(lstatSync(settingsPath).mode & 0o777, 0o600);
});

test("Agent lists skills and surgically updates only authorized skill files", async (t) => {
  const cwd = mkdtempSync(join(tmpdir(), "pi-resources-skills-"));
  const skillDir = join(agentDir, "skills", "route-skill");
  const skillPath = join(skillDir, "SKILL.md");
  mkdirSync(skillDir, { recursive: true });
  writeFileSync(skillPath, "---\nname: route-skill\ndescription: Route fixture\n---\nBody\n", { mode: 0o600 });
  allowFileRoot(cwd);
  t.after(() => {
    rmSync(cwd, { recursive: true, force: true });
    rmSync(skillDir, { recursive: true, force: true });
  });
  const base = await start(t);

  const listed = await request(base, `/internal/v1/api/skills?cwd=${encodeURIComponent(cwd)}`);
  assert.equal(listed.status, 200);
  assert.equal(listed.body.skills.some((skill) => skill.name === "route-skill"), true);

  assert.deepEqual(await request(base, "/internal/v1/api/skills", json("PATCH", {
    filePath: skillPath,
    disableModelInvocation: true,
  })), { status: 200, body: { success: true } });
  assert.equal(readFileSync(skillPath, "utf8"), "---\ndisable-model-invocation: true\nname: route-skill\ndescription: Route fixture\n---\nBody\n");

  const outside = mkdtempSync(join(tmpdir(), "pi-resources-skill-outside-"));
  const outsidePath = join(outside, "SKILL.md");
  writeFileSync(outsidePath, "---\nname: outside\ndescription: outside\n---\nBody\n");
  const link = join(skillDir, "outside.md");
  symlinkSync(outsidePath, link);
  t.after(() => rmSync(outside, { recursive: true, force: true }));
  assert.equal((await request(base, "/internal/v1/api/skills", json("PATCH", {
    filePath: link,
    disableModelInvocation: true,
  }))).status, 403);
});

test("Agent profile routes persist valid files and reject project symlink escapes", async (t) => {
  const base = await start(t);
  const cwd = mkdtempSync(join(tmpdir(), "pi-resources-project-"));
  const outside = mkdtempSync(join(tmpdir(), "pi-resources-outside-"));
  allowFileRoot(cwd);
  t.after(() => { rmSync(cwd, { recursive: true, force: true }); rmSync(outside, { recursive: true, force: true }); });

  assert.deepEqual(await request(base, "/internal/v1/api/subagents/profiles", json("PUT", { cwd, scope: "project", profile: profile() })), {
    status: 200,
    body: { profile: { ...profile(), scope: "project", filePath: join(cwd, ".pi", "agents", "route-agent.md") } },
  });
  const listed = await request(base, `/internal/v1/api/subagents/profiles?cwd=${encodeURIComponent(cwd)}`);
  assert.equal(listed.status, 200);
  assert.equal(listed.body.profiles.some((item) => item.name === "route-agent" && item.scope === "project"), true);
  assert.equal(readFileSync(join(cwd, ".pi", "agents", "route-agent.md"), "utf8").includes("tools: none"), true);
  assert.equal((await request(base, "/internal/v1/api/subagents/profiles", json("PUT", { cwd, scope: "project", profile: profile("../escape") }))).status, 400);
  assert.deepEqual(await request(base, "/internal/v1/api/subagents/profiles", json("PUT", { cwd, scope: "project" })), { status: 400, body: { error: "profile required" } });
  assert.deepEqual(await request(base, "/internal/v1/api/subagents/profiles", json("PUT", { cwd, scope: "workspace", profile: profile() })), { status: 400, body: { error: "scope must be global or project" } });
  assert.deepEqual(await request(base, "/internal/v1/api/subagents/profiles", json("PATCH", { cwd, scope: "project", name: "missing", enabled: false })), { status: 404, body: { error: "Agent profile not found" } });
  assert.deepEqual(await request(base, "/internal/v1/api/subagents/profiles", json("PATCH", { cwd, scope: "project", name: "route-agent" })), { status: 400, body: { error: "enabled required" } });

  const global = await request(base, "/internal/v1/api/subagents/profiles", json("PUT", {
    cwd,
    scope: "global",
    profile: { ...profile(), description: "Global profile" },
  }));
  assert.equal(global.status, 200);
  const sources = (await request(base, `/internal/v1/api/subagents/profiles?cwd=${encodeURIComponent(cwd)}`)).body.profiles
    .filter((item) => item.name === "route-agent")
    .sort((left, right) => left.scope.localeCompare(right.scope));
  assert.deepEqual(sources.map((item) => item.scope), ["global", "project"]);
  const toggled = await request(base, "/internal/v1/api/subagents/profiles", json("PATCH", {
    cwd,
    scope: "global",
    name: "route-agent",
    enabled: false,
  }));
  assert.equal(toggled.status, 200);
  assert.equal(toggled.body.profile.description, "Global profile");
  assert.equal(toggled.body.profile.enabled, false);
  assert.equal((await request(base, "/internal/v1/api/subagents/profiles", json("DELETE", { cwd, scope: "global", name: "route-agent" }))).status, 200);

  rmSync(join(cwd, ".pi"), { recursive: true, force: true });
  mkdirSync(cwd, { recursive: true });
  symlinkSync(outside, join(cwd, ".pi"), "dir");
  const escaped = await request(base, "/internal/v1/api/subagents/profiles", json("PUT", { cwd, scope: "project", profile: profile("escaped") }));
  assert.equal(escaped.status, 400);
  assert.match(escaped.body.error, /outside the project root/);
});

test("Agent plugin management preserves project scope and trust without registry access", async (t) => {
  const base = await start(t);
  const cwd = mkdtempSync(join(tmpdir(), "pi-resources-plugin-project-"));
  const packageDir = mkdtempSync(join(tmpdir(), "pi-resources-plugin-package-"));
  mkdirSync(join(cwd, ".pi", "extensions"), { recursive: true });
  writeFileSync(join(packageDir, "package.json"), JSON.stringify({ name: "route-plugin", version: "1.2.3", pi: { extensions: ["extension.js"] } }));
  writeFileSync(join(packageDir, "extension.js"), "export default function () {}\n");
  allowFileRoot(cwd);
  t.after(() => { rmSync(cwd, { recursive: true, force: true }); rmSync(packageDir, { recursive: true, force: true }); });

  let response = await request(base, "/internal/v1/api/plugins", json("POST", { action: "install", source: packageDir, scope: "project", cwd }));
  assert.equal(response.status, 403);
  assert.deepEqual(response.body, { error: "Project resources must be trusted before modifying project plugins" });

  assert.equal((await request(base, "/internal/v1/api/project-trust", json("POST", { cwd }))).status, 200);
  response = await request(base, "/internal/v1/api/plugins", json("POST", { action: "install", source: packageDir, scope: "project", cwd }));
  assert.equal(response.status, 200);
  const storedSource = relative(join(cwd, ".pi"), packageDir);
  assert.equal(response.body.packages.some((item) => item.source === storedSource && item.scope === "project" && item.packageName === "route-plugin"), true);
  assert.deepEqual(JSON.parse(readFileSync(join(cwd, ".pi", "settings.json"), "utf8")).packages, [storedSource]);

  response = await request(base, "/internal/v1/api/plugins", json("POST", { action: "disable", source: storedSource, scope: "project", cwd }));
  assert.equal(response.status, 200);
  assert.equal(response.body.packages.find((item) => item.source === storedSource).disabled, true);
  response = await request(base, "/internal/v1/api/plugins", json("POST", { action: "enable", source: storedSource, scope: "project", cwd }));
  assert.equal(response.status, 200);
  assert.equal(response.body.packages.find((item) => item.source === storedSource).disabled, false);
  response = await request(base, "/internal/v1/api/plugins", json("POST", { action: "update", source: storedSource, scope: "project", cwd }));
  assert.equal(response.status, 200, JSON.stringify(response.body));

  response = await request(base, "/internal/v1/api/plugins", json("POST", { action: "remove", source: packageDir, scope: "project", cwd }));
  assert.equal(response.status, 200);
  assert.equal(response.body.packages.some((item) => item.source === storedSource), false);

  const malformedDir = join(agentDir, "malformed-route-plugin");
  mkdirSync(malformedDir, { recursive: true });
  writeFileSync(join(malformedDir, "package.json"), "{");
  t.after(() => rmSync(malformedDir, { recursive: true, force: true }));
  response = await request(base, "/internal/v1/api/plugins", json("POST", {
    action: "install", source: malformedDir, scope: "project", cwd,
  }));
  assert.equal(response.status, 200);
  const malformed = response.body.packages.find((item) => item.installedPath === malformedDir);
  assert.ok(malformed);
  assert.equal("packageName" in malformed, false);
  assert.equal("version" in malformed, false);
});

test("Agent serializes plugin package operations around the full read-modify-write", async (t) => {
  let active = 0;
  let maxActive = 0;
  let calls = 0;
  const empty = { packages: [], totals: { extensions: 0, skills: 0, prompts: 0, themes: 0 }, diagnostics: [], projectResourcesLoaded: true };
  const base = await start(t, {
    runNpx: async () => ({ stdout: "", stderr: "" }),
    fetch: async () => new Response("{}"),
    async mutatePlugins() {
      calls += 1;
      active += 1;
      maxActive = Math.max(maxActive, active);
      await new Promise((resolve) => setTimeout(resolve, 15));
      active -= 1;
      return empty;
    },
  });
  const cwd = mkdtempSync(join(tmpdir(), "pi-resources-plugin-serialized-"));
  allowFileRoot(cwd);
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  const responses = await Promise.all(["one", "two"].map((source) => request(base, "/internal/v1/api/plugins", json("POST", {
    action: "install", source, scope: "global", cwd,
  }))));
  assert.deepEqual(responses.map((response) => response.status), [200, 200]);
  assert.equal(calls, 2);
  assert.equal(maxActive, 1);
});

test("Agent redacts private paths from plugin operation failures", async (t) => {
  const cwd = mkdtempSync(join(tmpdir(), "pi-resources-plugin-error-"));
  allowFileRoot(cwd);
  const base = await start(t, {
    runNpx: async () => ({ stdout: "", stderr: "" }),
    fetch: async () => new Response("{}"),
    mutatePlugins: async () => { throw new Error(`failed in ${agentDir}/packages/private`); },
  });
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  const failed = await request(base, "/internal/v1/api/plugins", json("POST", {
    action: "install", source: "private-package", scope: "global", cwd,
  }));
  assert.equal(failed.status, 500);
  assert.equal(JSON.stringify(failed.body).includes(agentDir), false);
  assert.match(failed.body.error, /<agent-dir>/);
});

test("Pi settings preserve concurrent local plugin mutations", async (t) => {
  const base = await start(t);
  const cwd = mkdtempSync(join(tmpdir(), "pi-resources-plugin-lock-"));
  const first = mkdtempSync(join(tmpdir(), "pi-resources-plugin-one-"));
  const second = mkdtempSync(join(tmpdir(), "pi-resources-plugin-two-"));
  mkdirSync(join(cwd, ".pi", "extensions"), { recursive: true });
  for (const [dir, name] of [[first, "one"], [second, "two"]]) {
    writeFileSync(join(dir, "package.json"), JSON.stringify({ name, version: "1.0.0", pi: { extensions: ["index.js"] } }));
    writeFileSync(join(dir, "index.js"), "export default function () {}\n");
  }
  allowFileRoot(cwd);
  t.after(() => { for (const path of [cwd, first, second]) rmSync(path, { recursive: true, force: true }); });
  assert.equal((await request(base, "/internal/v1/api/project-trust", json("POST", { cwd }))).status, 200);

  const responses = await Promise.all([first, second].map((source) => request(base, "/internal/v1/api/plugins", json("POST", {
    action: "install", source, scope: "project", cwd,
  }))));
  assert.deepEqual(responses.map((response) => response.status), [200, 200]);
  const configured = JSON.parse(readFileSync(join(cwd, ".pi", "settings.json"), "utf8")).packages;
  assert.equal(configured.length, 2);
});

test("Agent serializes skill installs and searches through controlled providers", async (t) => {
  let active = 0;
  let maxActive = 0;
  const calls = [];
  const resources = {
    async runNpx(args, options) {
      assert.ok(options.signal instanceof AbortSignal);
      calls.push({ args, cwd: options.cwd });
      active += 1;
      maxActive = Math.max(maxActive, active);
      await new Promise((resolve) => setTimeout(resolve, 15));
      active -= 1;
      return args[1] === "find"
        ? { stdout: "owner/fallback@skill  2K installs\n└ https://skills.sh/owner/fallback/skill\n", stderr: "" }
        : { stdout: "Installation complete\n", stderr: "" };
    },
    async fetch(_input, init) {
      assert.ok(init.signal instanceof AbortSignal);
      return new Response(JSON.stringify({ skills: [{ id: "owner/repo/demo", name: "demo", source: "owner/repo", installs: 1200 }] }), {
        headers: { "content-type": "application/json" },
      });
    },
  };
  const base = await start(t, resources);

  const installs = await Promise.all([
    request(base, "/internal/v1/api/skills/install", json("POST", { package: "owner/one@demo", scope: "global" })),
    request(base, "/internal/v1/api/skills/install", json("POST", { package: "owner/two@demo", scope: "global" })),
  ]);
  assert.deepEqual(installs.map((result) => result.status), [200, 200]);
  assert.equal(maxActive, 1);
  assert.deepEqual(calls.slice(0, 2).map((call) => call.args), [
    ["skills", "add", "owner/one@demo", "-y", "--agent", "pi", "-g"],
    ["skills", "add", "owner/two@demo", "-y", "--agent", "pi", "-g"],
  ]);

  assert.deepEqual(await request(base, "/internal/v1/api/skills/search", json("POST", { query: "demo", limit: 1 })), {
    status: 200,
    body: { results: [{ package: "owner/repo@demo", installs: "1.2K installs", url: "https://skills.sh/owner/repo/demo" }] },
  });

  resources.fetch = async () => new Response(JSON.stringify({ skills: "malformed" }));
  assert.deepEqual(await request(base, "/internal/v1/api/skills/search", json("POST", { query: "fallback", limit: 1 })), {
    status: 200,
    body: { results: [{ package: "owner/fallback@skill", installs: "2K installs", url: "https://skills.sh/owner/fallback/skill" }] },
  });
  assert.deepEqual(calls.at(-1).args, ["skills", "find", "fallback"]);

  let oversizedCancelled = false;
  let oversizedPulls = 0;
  let oversizedTimer;
  resources.fetch = async () => new Response(new ReadableStream({
    pull(controller) {
      oversizedPulls += 1;
      if (oversizedPulls <= 2) controller.enqueue(new Uint8Array(1_100_000));
      else return new Promise((resolve) => { oversizedTimer = setTimeout(() => { controller.close(); resolve(); }, 100); });
    },
    cancel() { clearTimeout(oversizedTimer); oversizedCancelled = true; },
  }));
  assert.equal((await request(base, "/internal/v1/api/skills/search", json("POST", { query: "oversized" }))).status, 200);
  assert.equal(oversizedCancelled, true);

  resources.runNpx = async () => { throw new Error(`failed in ${agentDir}/private-cache`); };
  const failed = await request(base, "/internal/v1/api/skills/install", json("POST", { package: "owner/fail@demo", scope: "global" }));
  assert.equal(failed.status, 500);
  assert.equal(JSON.stringify(failed.body).includes(agentDir), false);
  const failedSearch = await request(base, "/internal/v1/api/skills/search", json("POST", { query: "private" }));
  assert.equal(failedSearch.status, 500);
  assert.equal(JSON.stringify(failedSearch.body).includes(agentDir), false);
});

test("resource mutation routes preserve validation status codes before external work", async (t) => {
  const base = await start(t, {
    runNpx: async () => { throw new Error("must not run"); },
    fetch: async () => { throw new Error("must not fetch"); },
  });
  const outside = mkdtempSync(join(tmpdir(), "pi-resources-denied-"));
  const untrusted = mkdtempSync(join(tmpdir(), "pi-resources-untrusted-"));
  mkdirSync(join(untrusted, ".pi", "extensions"), { recursive: true });
  writeFileSync(join(untrusted, ".pi", "extensions", "extension.ts"), "export default () => {};");
  allowFileRoot(untrusted);
  t.after(() => {
    rmSync(outside, { recursive: true, force: true });
    rmSync(untrusted, { recursive: true, force: true });
  });

  assert.equal((await request(base, "/internal/v1/api/plugins", json("POST", { action: "install", source: "/tmp/package" }))).status, 400);
  assert.equal((await request(base, "/internal/v1/api/plugins", json("POST", { action: "install", source: "/tmp/package", cwd: outside }))).status, 403);
  assert.equal((await request(base, "/internal/v1/api/plugins", json("POST", { action: "install", scope: "project", cwd: untrusted }))).status, 403);
  assert.equal((await request(base, "/internal/v1/api/plugins", json("POST", { action: "unsupported", scope: "project", cwd: untrusted }))).status, 403);
  assert.equal((await request(base, "/internal/v1/api/skills/install", json("POST", { package: "owner/repo", scope: "project" }))).status, 400);
  assert.equal((await request(base, "/internal/v1/api/skills/install", json("POST", { package: "owner/repo", scope: "project", cwd: outside }))).status, 403);
  assert.equal((await request(base, "/internal/v1/api/skills/check", json("POST", {}))).status, 400);
  assert.equal((await request(base, "/internal/v1/api/skills/check", json("POST", { cwd: outside }))).status, 403);
  assert.equal((await request(base, "/internal/v1/api/skills/update", json("POST", {}))).status, 400);
  assert.equal((await request(base, "/internal/v1/api/skills/update", json("POST", { cwd: outside, package: "owner/repo", scope: "project" }))).status, 403);
  assert.deepEqual(await request(base, "/internal/v1/api/skills/update", json("POST", {
    cwd: untrusted, package: "owner/repo@demo", scope: "project",
  })), {
    status: 403,
    body: { error: "Project resources must be trusted before updating project skills" },
  });
});

test("Agent skill checks use only Agent-owned GitHub credentials", async (t) => {
  const cwd = mkdtempSync(join(tmpdir(), "pi-resources-global-check-"));
  const skillDir = join(agentDir, "skills", "private-demo");
  const stateDir = mkdtempSync(join(tmpdir(), "pi-resources-state-"));
  mkdirSync(skillDir, { recursive: true });
  mkdirSync(join(stateDir, "skills"), { recursive: true });
  writeFileSync(join(skillDir, "SKILL.md"), "---\nname: private-demo\ndescription: Private\n---\nBody\n");
  writeFileSync(join(stateDir, "skills", ".skill-lock.json"), JSON.stringify({ skills: { "private-demo": {
    source: "owner/private",
    sourceType: "github",
    skillPath: "private-demo/SKILL.md",
    skillFolderHash: "same-hash",
  } } }));
  allowFileRoot(cwd);
  const previousState = process.env.XDG_STATE_HOME;
  const previousToken = process.env.GITHUB_TOKEN;
  process.env.XDG_STATE_HOME = stateDir;
  process.env.GITHUB_TOKEN = "agent-github-token";
  t.after(() => {
    if (previousState === undefined) delete process.env.XDG_STATE_HOME; else process.env.XDG_STATE_HOME = previousState;
    if (previousToken === undefined) delete process.env.GITHUB_TOKEN; else process.env.GITHUB_TOKEN = previousToken;
    rmSync(cwd, { recursive: true, force: true });
    rmSync(skillDir, { recursive: true, force: true });
    rmSync(stateDir, { recursive: true, force: true });
  });
  const base = await start(t, {
    runNpx: async () => { throw new Error("must not run"); },
    async fetch(_input, init) {
      assert.equal(new Headers(init.headers).get("authorization"), "Bearer agent-github-token");
      return new Response(JSON.stringify({ tree: [{ path: "private-demo", type: "tree", sha: "same-hash" }] }));
    },
  });
  const checked = await request(base, "/internal/v1/api/skills/check", json("POST", {
    cwd, package: "owner/private@private-demo", scope: "global",
  }));
  assert.equal(checked.status, 200);
  assert.equal(checked.body.updates[0].state, "up-to-date");
});

test("Agent checks and updates lockfile-backed skills through controlled providers", async (t) => {
  const cwd = mkdtempSync(join(tmpdir(), "pi-resources-skill-update-"));
  const skillDir = join(cwd, ".pi", "skills", "demo");
  mkdirSync(skillDir, { recursive: true });
  writeFileSync(join(skillDir, "SKILL.md"), "---\nname: demo\ndescription: Demo\n---\nBody\n");
  writeFileSync(join(cwd, "skills-lock.json"), JSON.stringify({ skills: { demo: {
    source: "owner/repo",
    sourceType: "github",
    skillPath: "demo/SKILL.md",
    computedHash: "old-hash",
  } } }));
  allowFileRoot(cwd);
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  const calls = [];
  const resources = {
    async runNpx(args, options) {
      calls.push({ args, cwd: options.cwd });
      return { stdout: "updated\n", stderr: "" };
    },
    async fetch(input) {
      assert.equal(input, "https://skills.sh/api/download/owner/repo/demo");
      return new Response(JSON.stringify({ hash: "new-hash" }));
    },
  };
  const base = await start(t, resources);
  assert.equal((await request(base, "/internal/v1/api/project-trust", json("POST", { cwd }))).status, 200);

  assert.deepEqual(await request(base, "/internal/v1/api/skills/check", json("POST", {
    cwd, package: "owner/repo@demo", scope: "project",
  })), {
    status: 200,
    body: { updates: [{
      package: "owner/repo@demo",
      scope: "project",
      state: "update-available",
      currentVersion: "old-hash",
      latestVersion: "new-hash",
    }] },
  });
  const updated = await request(base, "/internal/v1/api/skills/update", json("POST", {
    cwd, package: "owner/repo@demo", scope: "project",
  }));
  assert.equal(updated.status, 200);
  assert.equal(updated.body.success, true);
  assert.equal(updated.body.output, "updated\n");
  assert.deepEqual(calls, [{
    args: ["skills", "add", "owner/repo/demo", "--skill", "demo", "-y", "--agent", "pi"],
    cwd,
  }]);
});

test("resource routes preserve legacy malformed JSON and non-object validation responses", async (t) => {
  const base = await start(t);
  assert.equal((await request(base, "/internal/v1/api/plugins", rawJson("POST", "{"))).status, 500);
  assert.deepEqual(await request(base, "/internal/v1/api/plugins", json("POST", [])), {
    status: 400,
    body: { error: "cwd required" },
  });
  assert.equal((await request(base, "/internal/v1/api/subagents/profiles", rawJson("PUT", "{"))).status, 400);
});

test("Agent project trust validates allowed roots and persists the decision", async (t) => {
  const base = await start(t);
  const cwd = mkdtempSync(join(tmpdir(), "pi-resources-trust-"));
  mkdirSync(join(cwd, ".pi", "extensions"), { recursive: true });
  allowFileRoot(cwd);
  t.after(() => rmSync(cwd, { recursive: true, force: true }));

  assert.deepEqual(await request(base, `/internal/v1/api/project-trust?cwd=${encodeURIComponent(cwd)}`), {
    status: 200,
    body: { requiresTrust: true, trusted: false },
  });
  const previousSessions = globalThis.__piAgentServerSessions;
  t.after(() => { globalThis.__piAgentServerSessions = previousSessions; });
  globalThis.__piAgentServerSessions = new Map([["busy", { cwd, isRunning: () => true }]]);
  assert.deepEqual(await request(base, "/internal/v1/api/project-trust", json("POST", { cwd })), {
    status: 409,
    body: { error: "Wait for the active session to finish before trusting this project" },
  });
  globalThis.__piAgentServerSessions = previousSessions;
  assert.deepEqual(await request(base, "/internal/v1/api/project-trust", json("POST", { cwd })), {
    status: 200,
    body: { requiresTrust: true, trusted: true },
  });
  const forbidden = mkdtempSync(join(tmpdir(), "pi-resources-forbidden-"));
  const file = join(cwd, "not-a-directory");
  writeFileSync(file, "x");
  t.after(() => rmSync(forbidden, { recursive: true, force: true }));
  assert.equal((await request(base, `/internal/v1/api/project-trust?cwd=${encodeURIComponent(forbidden)}`)).status, 403);
  assert.deepEqual(await request(base, `/internal/v1/api/project-trust?cwd=${encodeURIComponent(file)}`), {
    status: 400,
    body: { error: "cwd must be a directory" },
  });
  assert.deepEqual(await request(base, "/internal/v1/api/project-trust?cwd="), {
    status: 400,
    body: { error: "cwd required" },
  });
});
