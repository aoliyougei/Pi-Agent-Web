import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(new URL("../../../packages/pi-web-agent-server/src/routes/files.ts", import.meta.url), "utf8");
const start = source.indexOf("async function streamFile");
const end = source.indexOf("function toRequest", start);
assert.notEqual(start, -1, "Agent streamFile not found");
assert.notEqual(end, -1, "Agent streamFile end not found");
const streamBlock = source.slice(start, end);

test("Agent-owned streamed responses preserve no-sniff and SVG CSP headers", () => {
  assert.match(streamBlock, /"x-content-type-options": "nosniff"/);
  assert.match(streamBlock, /contentType === "image\/svg\+xml"/);
  assert.match(streamBlock, /content-security-policy/);
  assert.match(streamBlock, /default-src 'none'/);
  assert.match(streamBlock, /frame-ancestors 'self'/);
});

test("Agent-owned streams preserve range and cancellation handling", () => {
  assert.match(streamBlock, /status = 206/);
  assert.match(streamBlock, /"content-range"/);
  assert.match(streamBlock, /request\.once\("aborted", cancel\)/);
  assert.match(streamBlock, /response\.once\("close", cancel\)/);
});
