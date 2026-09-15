import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const publicRouteSrc = readFileSync(new URL("./[id]/context/route.ts", import.meta.url), "utf8");
const agentRouteSrc = readFileSync(new URL("../../../packages/pi-web-agent-server/src/routes/sessions.ts", import.meta.url), "utf8");

test("context pagination lives in Agent Server behind a thin public proxy", () => {
  assert.match(publicRouteSrc, /remoteSessionRoutes\.CONTEXT/);
  assert.match(agentRouteSrc, /const tail = Number\.isFinite\(rawTail\) && rawTail > 0 \? Math\.min\(rawTail, 1000\) : 50/);
  assert.match(agentRouteSrc, /const before = params\.get\("before"\)/);
  assert.match(agentRouteSrc, /excludeLeaf: Boolean\(before\)/);
});
