import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const publicRouteSrc = readFileSync(new URL("./[id]/route.ts", import.meta.url), "utf8");
const agentRouteSrc = readFileSync(new URL("../../../packages/pi-web-agent-server/src/routes/sessions.ts", import.meta.url), "utf8");

test("detail pagination and stats live in Agent Server behind a thin public proxy", () => {
  assert.match(publicRouteSrc, /remoteSessionRoutes\.DETAIL/);
  assert.match(agentRouteSrc, /const rawTail = Number\(params\.get\("tail"\)\)/);
  assert.match(agentRouteSrc, /Number\.isFinite\(rawTail\) && rawTail > 0 \? Math\.min\(rawTail, 1000\) : 50/);
  assert.match(agentRouteSrc, /computeSessionStats\(entries as unknown as SessionEntry\[\]\)/);
  assert.match(agentRouteSrc, /messageCount: stats\.totalMessages/);
});
