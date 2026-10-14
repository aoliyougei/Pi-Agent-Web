import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const live = await readFile(new URL("./live/route.ts", import.meta.url), "utf8");
const ready = await readFile(new URL("./ready/route.ts", import.meta.url), "utf8");

test("web liveness is independent from agent availability", () => {
  assert.match(live, /status: "ok"/);
  assert.doesNotMatch(live, /agentFetch|checkAgentCompatibility/);
});

test("Web readiness keeps backend configuration accessible even with no working Agent", () => {
  assert.match(ready, /listBackends\(\)/);
  assert.doesNotMatch(ready, /agentFetch|checkAgentCompatibility/);
  assert.match(ready, /status: 503/);
});
