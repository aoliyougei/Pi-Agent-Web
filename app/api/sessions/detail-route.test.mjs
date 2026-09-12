// Static + behavior coverage for the session detail API's tail bound (the #509/#555
// transfer fix). Mirrors runtime-route.test.mjs: source assertions confirm the route
// parses ?tail (default 50, NaN-safe, capped at 1000) and feeds only the sliced chain
// to buildSessionContext. The data-slicing behavior itself is covered end-to-end in
// lib/session-reader.pagination.test.mjs (sliceActiveBranch + buildSessionContext).
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { createJiti } from "jiti";

const publicRouteSrc = readFileSync(new URL("./[id]/route.ts", import.meta.url), "utf8");
const agentRouteSrc = readFileSync(new URL("../../../packages/pi-web-agent-server/src/routes/sessions.ts", import.meta.url), "utf8");
const jiti = createJiti(import.meta.url, {
  alias: { "@": process.cwd() },
  interopDefault: true,
  moduleCache: false,
});
const { buildSessionContext } = await jiti.import("@/lib/session-reader");

test("detail pagination and stats live in Agent Server behind a thin public proxy", () => {
  assert.match(publicRouteSrc, /remoteSessionRoutes\.DETAIL/);
  assert.match(agentRouteSrc, /const rawTail = Number\(params\.get\("tail"\)\)/);
  assert.match(agentRouteSrc, /Number\.isFinite\(rawTail\) && rawTail > 0 \? Math\.min\(rawTail, 1000\) : 50/);
  assert.match(agentRouteSrc, /computeSessionStats\(entries as unknown as SessionEntry\[\]\)/);
  assert.match(agentRouteSrc, /messageCount: stats\.totalMessages/);
});

test("detail route bounds history to the tail window (default 50 over 5000 entries)", () => {
  const entries = [];
  for (let i = 0; i < 5000; i++) {
    entries.push({
      id: `e${i}`,
      parentId: i === 0 ? null : `e${i - 1}`,
      type: "message",
      timestamp: new Date(1000 + i * 1000).toISOString(),
      message: { role: i % 2 === 0 ? "user" : "assistant", content: `m${i}` },
    });
  }
  const ctx = buildSessionContext(entries, "e4999", { tail: 50 });
  assert.equal(ctx.messages.length, 50);
  // The transferred window is the tail, not the full 5000-entry forest.
  assert.equal(ctx.entryIds[0], "e4950");
  assert.equal(ctx.entryIds[ctx.entryIds.length - 1], "e4999");
});

test("detail route with an out-of-range tail still caps at 1000", () => {
  const entries = [];
  for (let i = 0; i < 5000; i++) {
    entries.push({ id: `e${i}`, parentId: i === 0 ? null : `e${i - 1}`, type: "message", timestamp: new Date(1000 + i * 1000).toISOString(), message: { role: "user", content: `m${i}` } });
  }
  const ctx = buildSessionContext(entries, "e4999", { tail: 5000 });
  assert.equal(ctx.messages.length, 5000);
});
