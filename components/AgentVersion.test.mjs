import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
test("chat displays connected RPC version instead of a build-time Pi version", async () => {
  const chat = await readFile(new URL("./ChatWindow.tsx", import.meta.url), "utf8");
  assert.match(chat, /<AgentVersion/);
  assert.doesNotMatch(chat, /NewSessionUpdateLink|\/api\/app-update/);
  assert.match(chat, /pi-agent-web/);
  assert.match(chat, /NEXT_PUBLIC_PROJECT_VERSION/);
  assert.doesNotMatch(chat, /NEXT_PUBLIC_PI_VERSION/);
  const source = await readFile(new URL("./AgentVersion.tsx", import.meta.url), "utf8");
  assert.match(source, /\/api\/agent\/version/);
  assert.match(source, /serverVersion/);
  assert.match(source, /pi-agent-rpc/);
  assert.match(source, /AbortController/);
});
