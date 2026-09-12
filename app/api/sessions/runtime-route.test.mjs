import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import test from "node:test";

const root = new URL("./", import.meta.url);
const agentRoute = await readFile(new URL("../../../packages/pi-web-agent-server/src/routes/sessions.ts", import.meta.url), "utf8");

async function routes(directory = root) {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const url = new URL(`${entry.name}${entry.isDirectory() ? "/" : ""}`, directory);
    if (entry.isDirectory()) files.push(...await routes(url));
    else if (entry.name === "route.ts" && !url.pathname.includes("/ssh-environment/")) files.push(url);
  }
  return files;
}

test("migrated public Session routes are thin remote-only handlers", async () => {
  const files = await routes();
  assert.equal(files.length, 8);
  for (const file of files) {
    const source = await readFile(file, "utf8");
    assert.match(source, /@\/lib\/agent-rpc\/routes\/session-instance/);
    assert.doesNotMatch(source, /SessionManager|rpc-manager|session-reader|node:fs|from "fs"|child_process/);
    assert.ok(source.split("\n").length <= 6, file.pathname);
  }
});

test("Agent Session reads prefer live Runtime state before disk lookup", () => {
  const open = agentRoute.slice(agentRoute.indexOf("async function openSession"), agentRoute.indexOf("async function detail"));
  assert.ok(open.indexOf("getRpcSession(id)") < open.indexOf("resolveSessionPath(id)"));
  assert.match(agentRoute, /runtime\?\.isAlive\(\) \? runtime\.inner\.sessionManager : SessionManager\.open/);
  assert.match(agentRoute, /if \(runtime\?\.isAlive\(\)\)[\s\S]*?runtime\.send\(\{ type: "get_state" \}\)/);
});

test("Agent Session mutations retain lock and reparent semantics", () => {
  assert.match(agentRoute, /acquireSessionLock\(file,/);
  assert.match(agentRoute, /"rpc-session-rename"/);
  assert.match(agentRoute, /await getRpcSession\(id\)\?\.shutdown\(\)/);
  assert.match(agentRoute, /"rpc-session-delete"/);
  assert.match(agentRoute, /parentSessionId: parentId, parentSessionPath: parentPath/);
  assert.match(agentRoute, /invalidateSessionPathCache\(id\)/);
});
