import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { interopDefault: true, moduleCache: false });
const { SessionRuntime } = await jiti.import("../src/runtime/session-runtime.ts");
const { createAgentServer } = await import("../dist/server.js");
const token = "server-secret";
const version = { protocolVersion: 1, serverVersion: "0.1.0", piVersion: "0.84.4", piRevision: "revision", capabilities: [] };

function runtime() {
  return new SessionRuntime({
    sessionId: "session-1",
    sessionManager: { getCwd: () => "/tmp" },
    agent: { state: {} },
    extensionRunner: {},
    isStreaming: false,
    isCompacting: false,
    isBashRunning: false,
    dispose() {},
  });
}

async function pending(runtime, method) {
  for (let i = 0; i < 20; i += 1) {
    const request = runtime.getPendingExtensionUiRequests().find((item) => item.method === method);
    if (request) return request;
    await new Promise((resolve) => setImmediate(resolve));
  }
  throw new Error(`missing ${method}`);
}

test("ordinary dialogs round-trip once with method-specific response shapes", async (t) => {
  const session = runtime();
  t.after(() => session.destroy());
  const ui = session.createExtensionUiContext();
  const cases = [
    ["select", () => ui.select("pick", ["a"]), { value: "a" }, "a"],
    ["confirm", () => ui.confirm("danger", "run?"), { confirmed: false }, false],
    ["input", () => ui.input("name", "placeholder"), { value: "x" }, "x"],
    ["editor", () => ui.editor("edit", "prefill"), { value: "text" }, "text"],
  ];
  for (const [method, invoke, response, expected] of cases) {
    const result = invoke();
    const request = await pending(session, method);
    assert.equal(session.respondToExtensionUi(request.id, response), true);
    assert.equal(await result, expected);
    assert.equal(session.respondToExtensionUi(request.id, response), false);
    assert.equal(session.getPendingExtensionUiRequests().some((item) => item.id === request.id), false);
  }
});

test("rejects wrong response shapes without settling the dialog", async (t) => {
  const session = runtime();
  t.after(() => session.destroy());
  const result = session.createExtensionUiContext().confirm("danger", "run?");
  const request = await pending(session, "confirm");
  assert.equal(session.respondToExtensionUi(request.id, { value: "yes" }), false);
  await assert.rejects(
    session.send({ type: "extension_ui_response", id: request.id, value: "yes" }),
    /Invalid extension UI response/,
  );
  assert.equal(session.getPendingExtensionUiRequests().length, 1);
  assert.equal(session.respondToExtensionUi(request.id, { cancelled: true }), true);
  assert.equal(await result, false);
});

test("timeout and abort remove pending dialogs and preserve default values", async (t) => {
  const session = runtime();
  t.after(() => session.destroy());
  const ui = session.createExtensionUiContext();
  assert.equal(await ui.confirm("timeout", "wait", { timeout: 5 }), false);
  assert.deepEqual(session.getPendingExtensionUiRequests(), []);

  const controller = new AbortController();
  const result = ui.input("abort", undefined, { signal: controller.signal });
  await pending(session, "input");
  controller.abort();
  assert.equal(await result, undefined);
  assert.deepEqual(session.getPendingExtensionUiRequests(), []);
});

test("pending HTTP recovery is session-scoped and cancellation prevents execution", async (t) => {
  const session = runtime();
  let executed = false;
  const dangerous = (async () => {
    if (await session.createExtensionUiContext().confirm("danger", "execute?")) executed = true;
  })();
  const request = await pending(session, "confirm");
  const agent = {
    open: async (id) => id === "session-1" ? session : null,
    send: async () => ({ found: false }),
    create: async () => { throw new Error("unused"); },
    running: () => ({ runningSessionIds: [], completionNotificationSuppressedSessionIds: [] }),
  };
  const app = createAgentServer({ token, version, agent });
  await app.listen("127.0.0.1", 0);
  t.after(async () => { session.destroy(); await app.close(); });
  const address = app.address();
  const base = `http://127.0.0.1:${address.port}`;
  const headers = { authorization: `Bearer ${token}` };

  assert.equal((await fetch(`${base}/internal/v1/api/agent/%ZZ/extension-ui/pending`, { headers })).status, 400);
  for (let i = 0; i < 2; i += 1) {
    const response = await fetch(`${base}/internal/v1/api/agent/session-1/extension-ui/pending`, { headers });
    assert.equal(response.status, 200);
    assert.deepEqual((await response.json()).requests.map((item) => item.id), [request.id]);
  }
  assert.equal((await fetch(`${base}/internal/v1/api/agent/wrong/extension-ui/${request.id}/response`, {
    method: "POST", headers: { ...headers, "content-type": "application/json" }, body: '{"cancelled":true}',
  })).status, 404);
  assert.equal((await fetch(`${base}/internal/v1/api/agent/session-1/extension-ui/${request.id}/response`, {
    method: "POST", headers: { ...headers, "content-type": "application/json" }, body: '{"value":"wrong"}',
  })).status, 400);
  assert.equal((await fetch(`${base}/internal/v1/api/agent/session-1/extension-ui/${request.id}/response`, {
    method: "POST", headers: { ...headers, "content-type": "application/json" }, body: '{"cancelled":true}',
  })).status, 200);
  await dangerous;
  assert.equal(executed, false);
  assert.deepEqual(session.getPendingExtensionUiRequests(), []);
});

test("fire-and-forget UI methods emit events but never become pending", () => {
  const session = runtime();
  const events = [];
  session.onEvent((event) => events.push(event));
  const ui = session.createExtensionUiContext();
  ui.notify("note", "warning");
  ui.setStatus("key", "status");
  ui.setWidget("key", ["line"]);
  ui.setTitle("title");
  ui.setEditorText("text");
  assert.deepEqual(events.map((event) => event.method), ["notify", "setStatus", "setWidget", "setTitle", "set_editor_text"]);
  assert.deepEqual(session.getPendingExtensionUiRequests(), []);
  session.destroy();
});
