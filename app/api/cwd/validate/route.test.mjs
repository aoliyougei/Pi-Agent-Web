import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const publicSource = await readFile(new URL("./route.ts", import.meta.url), "utf8");
const agentSource = await readFile(new URL("../../../../packages/pi-web-agent-server/src/routes/files.ts", import.meta.url), "utf8");

test("cwd validation is a thin remote handler", () => {
  assert.match(publicSource, /remoteFileRoutes\.VALIDATE/);
  assert.doesNotMatch(publicSource, /node:fs|projectIdentityKey|resolveProject|allowFileRoot/);
});

test("Agent-owned cwd validation returns project identity and allows the root", () => {
  assert.match(agentSource, /allowFileRoot\(normalized\)/);
  assert.match(agentSource, /projectRoot: project\.projectRoot/);
  assert.match(agentSource, /projectKey: projectIdentityKey\(project\.projectRoot\)/);
});
