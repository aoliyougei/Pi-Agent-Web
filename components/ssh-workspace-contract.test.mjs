import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const sidebar = readFileSync(new URL("./SessionSidebar.tsx", import.meta.url), "utf8");
const app = readFileSync(new URL("./AppShell.tsx", import.meta.url), "utf8");
const memory = readFileSync(new URL("../lib/workspace-memory.ts", import.meta.url), "utf8");

test("sidebar renders distinct local and SSH workspaces and keeps empty local roots", () => {
  assert.match(sidebar, /sessionProjects/);
  assert.match(sidebar, /rememberedProjects/);
  assert.match(sidebar, /loadLocalWorkspaces|saveLocalWorkspace/);
  assert.match(sidebar, /workspaceKind/);
  assert.match(sidebar, /workspaceLabel/);
  assert.match(sidebar, /"SSH"\s*:\s*"Local"/);
  assert.doesNotMatch(sidebar, /remoteWorkspaceLabel \?\?/);
});

test("workspace selection chooses the Session directly without a cwd-first race", () => {
  const start = sidebar.indexOf("const session = workspaceSession(project.key)");
  const block = sidebar.slice(start, sidebar.indexOf("setProjectFilter", start));
  assert.match(block, /onSelectSession\(session\)/);
  assert.doesNotMatch(block, /setSelectedCwd\(session\.cwd\)/);
});

test("SSH selection warms the Runtime and memory prefers explicit workspace identity", () => {
  assert.match(app, /workspaceKeyOf\(selectedSession\)/);
  assert.match(app, /type:\s*"get_state"/);
  assert.match(app, /workspaceKind !== "ssh"/);
  assert.match(memory, /session\.workspaceKey \?\?/);
});

test("existing Session selection updates the anchor cwd without triggering workspace restore", () => {
  assert.match(app, /activeProjectKeyRef\.current = workspaceKeyOf\(session\)/);
  assert.match(app, /setActiveCwd\(session\.cwd\)/);
  assert.match(app, /suppressCwdBumpRef\.current = true/);
});
