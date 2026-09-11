import assert from "node:assert/strict";
import { connect } from "node:net";
import test from "node:test";
import { createAgentServer } from "../dist/server.js";

const token = "server-secret";
const version = {
  protocolVersion: 1,
  serverVersion: "0.1.0",
  piVersion: "0.84.4",
  piRevision: "revision",
  capabilities: [],
};

function runtimeFixture() {
  const listeners = new Set();
  return {
    listenerCount: () => listeners.size,
    emit: (event) => listeners.forEach((listener) => listener(event)),
    onEvent(listener) {
      listeners.add(listener);
      for (const frame of this.currentFrames()) listener(frame);
      return () => listeners.delete(listener);
    },
    currentFrames: () => [{ type: "extension_ui_request", method: "custom", id: "custom-1", lines: ["current"] }],
    streamingMessage: { role: "assistant", content: [] },
    send: async () => null,
  };
}

async function start(runtime, eventBufferCapacity = 3) {
  const agent = {
    open: async (id) => id === "known" ? runtime : null,
    send: async () => ({ found: false }),
    create: async () => { throw new Error("unused"); },
    running: () => ({ runningSessionIds: [], completionNotificationSuppressedSessionIds: [] }),
  };
  const app = createAgentServer({ token, version, agent, eventBufferCapacity });
  await app.listen("127.0.0.1", 0);
  const address = app.address();
  assert.ok(address && typeof address !== "string");
  return { app, url: `http://127.0.0.1:${address.port}` };
}

async function open(url, lastEventId) {
  const controller = new AbortController();
  const headers = { authorization: `Bearer ${token}` };
  if (lastEventId !== undefined) headers["last-event-id"] = lastEventId;
  const response = await fetch(`${url}/internal/v1/api/agent/known/events`, { headers, signal: controller.signal });
  return { response, controller, reader: response.body.getReader(), text: "" };
}

async function readUntil(connection, predicate) {
  while (!predicate(connection.text)) {
    const { value, done } = await connection.reader.read();
    if (done) break;
    connection.text += new TextDecoder().decode(value);
  }
  return connection.text;
}

function ids(text) {
  return [...text.matchAll(/^id: (\d+)$/gm)].map((match) => match[1]);
}

async function disconnect(connection) {
  connection.controller.abort();
  try { await connection.reader.read(); } catch (error) {
    if (error?.name !== "AbortError") throw error;
  }
}

test("rejects invalid configured event-buffer capacities", () => {
  const agent = {
    open: async () => null,
    send: async () => ({ found: false }),
    create: async () => { throw new Error("unused"); },
    running: () => ({ runningSessionIds: [], completionNotificationSuppressedSessionIds: [] }),
  };
  for (const eventBufferCapacity of [0, -1, 1.5, 100_001, Number.NaN]) {
    assert.throws(() => createAgentServer({ token, version, agent, eventBufferCapacity }), /Invalid event buffer capacity/);
  }
});

test("sends heartbeat, connected snapshot, and current custom frames immediately", async (t) => {
  const runtime = runtimeFixture();
  const { app, url } = await start(runtime);
  t.after(() => app.close());
  const connection = await open(url);
  const text = await readUntil(connection, (value) => value.includes('"current"'));
  await disconnect(connection);
  assert.match(text, /^:\n\n/);
  assert.match(text, /data: {"type":"connected","sessionId":"known","isStreaming":false}/);
  assert.match(text, /data: {"type":"extension_ui_request","method":"custom","id":"custom-1","lines":\["current"\]}/);
  assert.match(text, /data: {"type":"message_start","message":{"role":"assistant","content":\[\]}}/);
});

test("disconnects after N and replays N+1 onward exactly once", async (t) => {
  const runtime = runtimeFixture();
  const { app, url } = await start(runtime);
  t.after(() => app.close());

  const first = await open(url);
  await readUntil(first, (text) => text.includes('"connected"'));
  runtime.emit({ type: "one" });
  runtime.emit({ type: "two" });
  await readUntil(first, (text) => ids(text).length === 2);
  assert.deepEqual(ids(first.text), ["1", "2"]);
  await disconnect(first);

  runtime.emit({ type: "three" });
  runtime.emit({ type: "four" });
  const second = await open(url, "2");
  await readUntil(second, (text) => ids(text).length === 2);
  assert.deepEqual(ids(second.text), ["3", "4"]);
  assert.equal((second.text.match(/"three"/g) ?? []).length, 1);
  assert.equal((second.text.match(/"four"/g) ?? []).length, 1);
  await disconnect(second);
});

test("returns resync_required for stale and unknown cursors", async (t) => {
  const runtime = runtimeFixture();
  const { app, url } = await start(runtime, 2);
  t.after(() => app.close());
  const live = await open(url);
  await readUntil(live, (text) => text.includes('"connected"'));
  runtime.emit({ type: "one" });
  runtime.emit({ type: "two" });
  runtime.emit({ type: "three" });
  runtime.emit({ type: "four" });
  await readUntil(live, (text) => ids(text).length === 4);
  await disconnect(live);

  for (const cursor of ["1", "999", "bad"]) {
    const response = await fetch(`${url}/internal/v1/api/agent/known/events`, {
      headers: { authorization: `Bearer ${token}`, "last-event-id": cursor },
    });
    assert.equal(response.status, 409);
    assert.equal((await response.json()).error.code, "resync_required");
  }
});

test("disconnects a backpressured client instead of growing an unbounded queue", async () => {
  const runtime = runtimeFixture();
  const { app, url } = await start(runtime);
  const address = new URL(url);
  const socket = connect(Number(address.port), address.hostname);
  await new Promise((resolve, reject) => {
    socket.once("connect", resolve);
    socket.once("error", reject);
  });
  socket.write([
    "GET /internal/v1/api/agent/known/events HTTP/1.1",
    `Host: ${address.host}`,
    `Authorization: Bearer ${token}`,
    "Connection: keep-alive",
    "",
    "",
  ].join("\r\n"));
  socket.pause();
  await new Promise((resolve) => setTimeout(resolve, 10));
  const closed = new Promise((resolve) => socket.once("close", resolve));
  for (let index = 0; index < 2_000; index += 1) runtime.emit({ type: "chunk", data: "x".repeat(4096) });
  socket.resume();
  try {
    await Promise.race([
      closed,
      new Promise((_, reject) => setTimeout(() => reject(new Error("slow client remained connected")), 1_000)),
    ]);
  } finally {
    socket.destroy();
    await app.close();
  }
});

test("server shutdown removes the session capture subscription", async () => {
  const runtime = runtimeFixture();
  const { app, url } = await start(runtime);
  const connection = await open(url);
  await readUntil(connection, (text) => text.includes('"connected"'));
  assert.equal(runtime.listenerCount(), 1);
  await disconnect(connection);
  await app.close();
  assert.equal(runtime.listenerCount(), 0);
});
