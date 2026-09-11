import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";
const jiti = createJiti(import.meta.url, { moduleCache: false, interopDefault: true });
const { SessionRuntime } = await jiti.import("../src/runtime/session-runtime.ts");

function session(t) {
  const runtime = new SessionRuntime({ sessionId: "custom-session", sessionManager: { getCwd: () => "/tmp" }, agent: { state: {} }, extensionRunner: {}, dispose() {} });
  t.after(() => runtime.destroy());
  return runtime;
}
const turn = () => new Promise((resolve) => setImmediate(resolve));

test("real custom component emits revisions, accepts stale input, and closes once", async (t) => {
  const runtime = session(t);
  const events = [];
  runtime.onEvent((event) => events.push(event));
  let disposed = 0;
  const result = runtime.createExtensionUiContext().custom((_tui, _theme, _keys, done) => {
    let text = "initial";
    return {
      render: () => [text],
      handleInput(data) { if (data === "done") done(text); else text = data; },
      dispose() { disposed += 1; },
    };
  });
  await turn();
  const initial = runtime.currentFrames()[0];
  assert.equal(initial.revision, 1);
  assert.equal(initial.closed, false);
  assert.deepEqual(initial.lines, ["initial"]);
  assert.equal(runtime.inputCustomUi(initial.id, { data: "updated", revision: 0 }), true);
  assert.deepEqual(runtime.currentFrames()[0].lines, ["updated"]);
  assert.equal(runtime.currentFrames()[0].revision, 2);
  assert.equal(runtime.inputCustomUi(initial.id, { data: "done", revision: 1 }), true);
  assert.equal(await result, "updated");
  assert.equal(disposed, 1);
  assert.deepEqual(runtime.currentFrames(), []);
  assert.equal(events.at(-1).closed, true);
  assert.equal(events.at(-1).revision, 3);
  assert.equal(runtime.inputCustomUi(initial.id, { data: "again", revision: 2 }), false);
});

test("rejects wrong ids, future revisions, malformed and oversized input before component execution", async (t) => {
  const runtime = session(t);
  let calls = 0;
  runtime.createExtensionUiContext().custom(() => ({ render: () => ["frame"], handleInput() { calls += 1; } }));
  await turn();
  const { id } = runtime.currentFrames()[0];
  assert.equal(runtime.inputCustomUi("wrong", { data: "x", revision: 1 }), false);
  for (const input of [null, { data: 1, revision: 1 }, { data: "x", revision: -1 }, { data: "x", revision: 2 }, { data: "x".repeat(65537), revision: 1 }]) {
    assert.throws(() => runtime.inputCustomUi(id, input), /Invalid custom UI input/);
  }
  assert.equal(calls, 0);
});

test("HTTP input is session-scoped and reconnect restores the latest full component frame", async (t) => {
  const { createAgentServer } = await import("../dist/server.js");
  const runtime = session(t);
  let finish;
  runtime.createExtensionUiContext().custom((_tui, _theme, _keys, done) => {
    finish = done;
    let text = "first";
    return { render: () => [text], handleInput(data) { text = data; } };
  });
  await turn();
  const { id } = runtime.currentFrames()[0];
  const app = createAgentServer({
    token: "test-token",
    version: { protocolVersion: 1, serverVersion: "0.1.0", piVersion: "0.84.4", piRevision: "test", capabilities: [] },
    agent: {
      open: async (id) => id === "custom-session" ? runtime : null,
      send: async () => ({ found: false }),
      create: async () => { throw new Error("unused"); },
      running: () => ({ runningSessionIds: [], completionNotificationSuppressedSessionIds: [] }),
    },
  });
  await app.listen("127.0.0.1", 0);
  t.after(() => app.close());
  const base = `http://127.0.0.1:${app.address().port}/internal/v1/api/agent`;
  const headers = { authorization: "Bearer test-token", "content-type": "application/json" };
  const post = (sid, cid, input) => fetch(`${base}/${sid}/custom-ui/${cid}/input`, { method: "POST", headers, body: JSON.stringify(input) });
  const frame = async (cursor) => {
    const abort = new AbortController();
    const response = await fetch(`${base}/custom-session/events`, { headers: { ...headers, ...(cursor ? { "last-event-id": cursor } : {}) }, signal: abort.signal });
    const reader = response.body.getReader();
    let text = "";
    try {
      while (!text.includes('"method":"custom"')) {
        const { value, done } = await reader.read();
        if (done) throw new Error("SSE ended before frame");
        text += new TextDecoder().decode(value);
      }
      return text.split("\n").filter((line) => line.startsWith("data: ")).map((line) => JSON.parse(line.slice(6))).find((event) => event.method === "custom");
    } finally { abort.abort(); await reader.cancel().catch(() => {}); }
  };
  assert.deepEqual((await frame()).lines, ["first"]);
  assert.equal((await post("wrong-session", id, { data: "x", revision: 0 })).status, 404);
  assert.equal((await post("custom-session", "wrong", { data: "x", revision: 0 })).status, 409);
  assert.equal((await post("custom-session", id, { data: "x", revision: -1 })).status, 400);
  assert.equal((await post("custom-session", id, { data: "second", revision: 0 })).status, 200);
  const restored = await frame("1");
  assert.deepEqual(restored.lines, ["second"]);
  assert.equal(restored.revision, 2);
  finish();
  assert.equal((await post("custom-session", id, { data: "x", revision: 1 })).status, 409);
});

test("oversized component frames are closed without publishing unbounded lines", async (t) => {
  for (const lines of [Array(1001).fill("line"), ["界".repeat(90000)], [42]]) {
  const runtime = session(t);
  const events = [];
  runtime.onEvent((event) => events.push(event));
  const result = runtime.createExtensionUiContext().custom(() => ({ render: () => lines }));
  await turn();
  assert.equal(await result, undefined);
  assert.deepEqual(runtime.currentFrames(), []);
  assert.ok(events.some((event) => event.closed === true));
  assert.ok(events.every((event) => !event.lines || event.lines.length <= 1000));
  }
});
