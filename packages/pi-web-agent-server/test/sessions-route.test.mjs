import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";

const root = mkdtempSync(join(tmpdir(), "pi-sessions-route-"));
process.env.PI_CODING_AGENT_DIR = join(root, "agent");
const { SessionManager } = await import("@earendil-works/pi-coding-agent");
const { createAgentServer } = await import("../dist/server.js");
const token = "session-route-token";
const headers = { authorization: `Bearer ${token}` };

function normalize(value, key = "") {
  if ((key === "path" || key === "filePath") && typeof value === "string" && value.endsWith(".jsonl")) return "<session-file>";
  if (key === "projectKey" || key === "workspaceKey") return "<project-key>";
  if (key === "created" || key === "modified") return "<timestamp>";
  if (typeof value === "string") return value.replaceAll(root, "<root>");
  if (Array.isArray(value)) return value.map((item) => normalize(item));
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([name, item]) => [name, normalize(item, name)]));
  return value;
}

function fixture() {
  const manager = SessionManager.create(root);
  manager.appendSessionInfo("Named");
  manager.appendMessage({ role: "user", content: "first", timestamp: 1000 });
  manager.appendMessage({ role: "assistant", content: [{ type: "thinking", thinking: "secret" }, { type: "text", text: "answer" }], provider: "phase2", model: "echo", usage: { input: 1, output: 2, cacheRead: 0, cacheWrite: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } }, stopReason: "stop", timestamp: 2000 });
  const file = manager.getSessionFile();
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, [manager.getHeader(), ...manager.getEntries()].map((entry) => JSON.stringify(entry)).join("\n") + "\n{malformed\n");
  return { id: manager.getSessionId(), file };
}

async function start(t) {
  const app = createAgentServer({ token, version: { protocolVersion: 1 } });
  await app.listen("127.0.0.1", 0);
  t.after(() => app.close());
  return `http://127.0.0.1:${app.address().port}`;
}

async function request(base, path, init = {}) {
  const response = await fetch(base + path, { ...init, headers: { ...headers, ...(init.body ? { "content-type": "application/json" } : {}), ...init.headers } });
  const body = response.headers.get("content-type")?.includes("application/json")
    ? normalize(await response.json())
    : new Uint8Array(await response.arrayBuffer());
  return { status: response.status, cache: response.headers.get("cache-control"), type: response.headers.get("content-type"), body };
}
const get = (base, path) => request(base, path);

test("internal Session reads preserve normalized listing, detail, context and idle state", async (t) => {
  const { id } = fixture();
  const base = await start(t);
  const listing = await get(base, "/internal/v1/api/sessions?force=1");
  assert.equal(listing.status, 200);
  assert.equal(listing.cache, "no-store");
  assert.deepEqual(listing.body, {
    sessions: [{
      path: "<session-file>", id, cwd: "<root>", name: "Named",
      created: "<timestamp>", modified: "<timestamp>",
      messageCount: 2, firstMessage: "first", projectRoot: "<root>", projectKey: "<project-key>",
      transient: false, workspaceKind: "local", workspaceKey: "<project-key>", workspaceLabel: "<root>",
    }],
    runningSessionIds: [], completionNotificationSuppressedSessionIds: [],
  });

  const detail = await get(base, `/internal/v1/api/sessions/${id}?deferThinking=1&tail=1`);
  assert.equal(detail.status, 200);
  assert.equal(detail.body.sessionId, id);
  assert.equal(detail.body.context.messages.length, 1);
  assert.deepEqual(detail.body.context.messages[0].content, [{ type: "thinking", thinking: "", deferred: true }, { type: "text", text: "answer" }]);
  assert.deepEqual(detail.body.context.entryIds, [detail.body.leafId]);
  assert.equal(detail.body.context.hasMore, true);
  assert.equal(detail.body.stats.totalMessages, 2);
  assert.equal(detail.body.info.name, "Named");

  const context = await get(base, `/internal/v1/api/sessions/${id}/context?tail=1&before=${detail.body.leafId}`);
  assert.equal(context.status, 200);
  assert.equal(context.body.tail, 1);
  assert.equal(context.body.before, detail.body.leafId);
  assert.equal(context.body.context.messages[0].content, "first");

  assert.deepEqual(await get(base, `/internal/v1/api/sessions/${id}/state`), { status: 200, cache: null, type: "application/json; charset=utf-8", body: { running: false } });
});

test("internal Session rename honors the shared writer lock", async (t) => {
  const { id, file } = fixture();
  const base = await start(t);
  const renamed = await request(base, `/internal/v1/api/sessions/${id}`, { method: "PATCH", body: JSON.stringify({ name: " New name " }) });
  assert.deepEqual(renamed.body, { ok: true });
  assert.equal((await get(base, `/internal/v1/api/sessions/${id}`)).body.info.name, "New name");
  const { acquireSessionLock } = await import("../dist/runtime/session-lock.js");
  const lease = acquireSessionLock(file, join(process.env.PI_CODING_AGENT_DIR, "locks", "sessions"), "test-lock");
  try {
    const locked = await request(base, `/internal/v1/api/sessions/${id}`, { method: "PATCH", body: JSON.stringify({ name: "blocked" }) });
    assert.equal(locked.status, 409);
    assert.equal(locked.body.error.code, "session_locked");
  } finally { lease.release(); }
});

test("internal Session auto-name enters Runtime startup and honors its writer lock", async (t) => {
  const { id, file } = fixture();
  const base = await start(t);
  const result = await request(base, `/internal/v1/api/sessions/${id}/auto-name`, { method: "POST" });
  assert.notEqual(result.status, 409);
  assert.notDeepEqual(result.body, { error: "Session is not running" });
  assert.equal((await request(base, "/internal/v1/api/sessions/missing/auto-name", { method: "POST" })).status, 404);
  const { getRpcSession } = await import("../dist/runtime/session-runtime.js");
  await getRpcSession(id)?.shutdown();
  const { acquireSessionLock } = await import("../dist/runtime/session-lock.js");
  const lease = acquireSessionLock(file, join(process.env.PI_CODING_AGENT_DIR, "locks", "sessions"), "test-lock");
  try {
    const locked = await request(base, `/internal/v1/api/sessions/${id}/auto-name`, { method: "POST" });
    assert.equal(locked.status, 409);
    assert.equal(locked.body.error.code, "session_locked");
  } finally { lease.release(); }
});

test("internal Session entry routes return exact deferred thinking and bounded image bytes", async (t) => {
  const manager = SessionManager.create(root);
  manager.appendMessage({ role: "user", content: "media", timestamp: 1000 });
  const assistantId = manager.appendMessage({ role: "assistant", content: [{ type: "thinking", thinking: "reason" }], provider: "phase2", model: "echo", usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } }, stopReason: "stop", timestamp: 2000 });
  const image = Buffer.from("png-bytes");
  const toolId = manager.appendMessage({ role: "toolResult", toolCallId: "tool-1", toolName: "read", content: [{ type: "image", source: { type: "base64", media_type: "image/png", data: image.toString("base64") } }], timestamp: 3000 });
  const file = manager.getSessionFile();
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, [manager.getHeader(), ...manager.getEntries()].map((entry) => JSON.stringify(entry)).join("\n") + "\n");
  const base = await start(t), id = manager.getSessionId();
  assert.deepEqual((await get(base, `/internal/v1/api/sessions/${id}/entries/${assistantId}/thinking?blockIndex=0`)).body, { thinking: "reason" });
  const result = await get(base, `/internal/v1/api/sessions/${id}/entries/${toolId}/tool-result-image?blockIndex=0`);
  assert.equal(result.status, 200);
  assert.equal(result.type, "image/png");
  assert.deepEqual(result.body, new Uint8Array(image));
});

test("internal Session export preserves HTML and inline disposition", { timeout: 20000 }, async (t) => {
  const { id } = fixture();
  const base = await start(t);
  const response = await fetch(`${base}/internal/v1/api/sessions/${id}/export?inline=1`, { headers });
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type"), /^text\/html/);
  assert.match(response.headers.get("content-disposition"), /^inline;/);
  assert.match(await response.text(), /first/);
});

test("internal Session delete reparents a direct child", async (t) => {
  const parent = fixture();
  const grandparent = fixture();
  const child = SessionManager.create(root);
  const childFile = child.getSessionFile();
  mkdirSync(dirname(childFile), { recursive: true });
  writeFileSync(childFile, JSON.stringify({ ...child.getHeader(), parentSession: parent.file }) + "\n");
  const parentLines = (await import("node:fs/promises")).readFile;
  const original = (await parentLines(parent.file, "utf8")).split("\n");
  original[0] = JSON.stringify({ ...JSON.parse(original[0]), parentSession: grandparent.file });
  writeFileSync(parent.file, original.join("\n"));
  const base = await start(t);
  const deleted = await request(base, `/internal/v1/api/sessions/${parent.id}`, { method: "DELETE" });
  assert.deepEqual(deleted.body, { ok: true });
  const childHeader = JSON.parse((await parentLines(childFile, "utf8")).split("\n")[0]);
  assert.equal(normalize(childHeader.parentSession, "filePath"), "<session-file>");
  assert.equal(childHeader.parentSession, grandparent.file);
});

test("internal Session reads reject missing and invalid IDs without creating a runtime", async (t) => {
  const base = await start(t);
  assert.equal((await get(base, "/internal/v1/api/sessions/missing/context")).status, 404);
  assert.equal((await get(base, "/internal/v1/api/sessions/%2e%2e/state")).status, 404);
});

test.after(() => rmSync(root, { recursive: true, force: true }));
