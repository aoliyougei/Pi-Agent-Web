import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";

const root = mkdtempSync(join(tmpdir(), "pi-ssh-route-"));
process.env.PI_CODING_AGENT_DIR = join(root, "agent");
const { SessionManager } = await import("@earendil-works/pi-coding-agent");
const { createAgentServer } = await import("../dist/server.js");
const token = "ssh-route-token";
const auth = { authorization: `Bearer ${token}` };
test.after(() => rmSync(root, { recursive: true, force: true }));

const remoteState = {
  version: 2,
  target: "devbox",
  port: 2201,
  remotePlatform: "unix",
  remoteShell: "bash",
  remoteCwd: "/srv/app",
  remoteHome: "/home/dev",
  password: "must-not-leak",
};
const entry = { type: "custom", customType: "pi-ssh-remote-state", data: remoteState };

async function start(t) {
  const app = createAgentServer({ token, version: { protocolVersion: 1 } });
  await app.listen("127.0.0.1", 0);
  t.after(() => app.close());
  return `http://127.0.0.1:${app.address().port}`;
}

async function get(base, path) {
  const response = await fetch(base + path, { headers: auth });
  return { status: response.status, body: await response.json() };
}

function installLive(t, id, options = {}) {
  const previous = globalThis.__piAgentServerSessions;
  const calls = [];
  const tools = options.tools ?? {
    ls: { execute: async (_callId, input, signal, _update, context) => {
      calls.push({ name: "ls", input, signal, context });
      return { content: [{ type: "text", text: "a.ts\nsrc/\n" }], details: { secret: "hidden" } };
    } },
    read: { execute: async (_callId, input, signal, _update, context) => {
      calls.push({ name: "read", input, signal, context });
      return options.image
        ? { content: [{ type: "image", data: "aGVsbG8=", mimeType: "image/png" }], details: { secret: "hidden" } }
        : { content: [{ type: "text", text: "hello" }], details: { secret: "hidden" } };
    } },
  };
  globalThis.__piAgentServerSessions = new Map([[id, {
    isAlive: () => true,
    inner: {
      sessionManager: { getBranch: () => [entry], getCwd: () => "/local/anchor" },
      extensionRunner: {
        getToolDefinition: (name) => tools[name],
        hasHandlers: (name) => options.hasUserBashHandler !== false && name === "user_bash",
      },
      getToolDefinition: (name) => options.builtInTools?.[name] ?? tools[name],
    },
  }]]);
  t.after(() => { globalThis.__piAgentServerSessions = previous; });
  return calls;
}

test("Agent SSH route reads live and idle saved environments without leaking state", async (t) => {
  const base = await start(t);
  installLive(t, "live-ssh");

  let response = await get(base, "/internal/v1/api/sessions/live-ssh/ssh-environment");
  assert.equal(response.status, 200);
  assert.equal(response.body.source, "saved-session");
  assert.equal(response.body.environment.target, "devbox");
  assert.equal(JSON.stringify(response.body).includes("password"), false);

  const idle = SessionManager.create(root);
  idle.appendCustomEntry("pi-ssh-remote-state", remoteState);
  mkdirSync(dirname(idle.getSessionFile()), { recursive: true });
  writeFileSync(idle.getSessionFile(), [idle.getHeader(), ...idle.getEntries()].map((value) => JSON.stringify(value)).join("\n") + "\n");
  response = await get(base, `/internal/v1/api/sessions/${idle.getSessionId()}/ssh-environment`);
  assert.equal(response.status, 200);
  assert.equal(response.body.environment.remoteCwd, "/srv/app");

  assert.equal((await get(base, "/internal/v1/api/sessions/missing-ssh/ssh-environment")).status, 404);
  assert.equal((await get(base, "/internal/v1/api/sessions/%2Fescape/ssh-environment")).status, 400);
});

test("Agent remote Explorer executes only fixed remote tools with contained paths", async (t) => {
  const base = await start(t);
  const calls = installLive(t, "remote-ssh", { image: true });

  let response = await get(base, "/internal/v1/api/agent/remote-ssh/remote-files?path=src");
  assert.deepEqual(response, { status: 200, body: { path: "/srv/app/src", entries: [{ name: "a.ts", type: "file" }, { name: "src", type: "directory" }] } });
  assert.deepEqual(calls[0].input, { path: "/srv/app/src", limit: 500 });
  assert.equal(calls[0].context.cwd, "/local/anchor");
  assert.equal(calls[0].signal instanceof AbortSignal, true);

  response = await get(base, "/internal/v1/api/agent/remote-ssh/remote-file?path=images%2Fa.png");
  assert.deepEqual(response, { status: 200, body: { path: "/srv/app/images/a.png", file: { type: "image", data: "aGVsbG8=", mimeType: "image/png" } } });
  assert.equal(JSON.stringify(response.body).includes("secret"), false);

  assert.equal((await get(base, "/internal/v1/api/agent/remote-ssh/remote-file")).status, 400);
  assert.equal((await get(base, "/internal/v1/api/agent/remote-ssh/remote-files?path=..%2Fetc")).status, 400);
  assert.equal(calls.length, 2);
});

test("Agent remote Explorer fails closed when session, SSH state, or tool is unavailable", async (t) => {
  const base = await start(t);
  let localCalls = 0;
  installLive(t, "no-tool", {
    tools: {},
    builtInTools: { ls: { execute: async () => { localCalls += 1; return { content: [] }; } } },
  });

  let response = await get(base, "/internal/v1/api/agent/no-tool/remote-files");
  assert.equal(response.status, 400);
  assert.match(response.body.error, /unavailable/);
  assert.equal(localCalls, 0);

  let unrelatedCalls = 0;
  installLive(t, "unrelated-tool", {
    hasUserBashHandler: false,
    tools: { ls: { execute: async () => { unrelatedCalls += 1; return { content: [] }; } } },
  });
  response = await get(base, "/internal/v1/api/agent/unrelated-tool/remote-files");
  assert.equal(response.status, 400);
  assert.match(response.body.error, /unavailable/);
  assert.equal(unrelatedCalls, 0);

  assert.equal((await get(base, "/internal/v1/api/agent/missing/remote-files")).status, 409);
  assert.equal((await get(base, "/internal/v1/api/agent/%2Fescape/remote-files")).status, 400);
});

test("Agent remote Explorer aborts its fixed tool when the client disconnects", async (t) => {
  const base = await start(t);
  let toolStarted;
  const started = new Promise((resolve) => { toolStarted = resolve; });
  let toolAborted;
  const aborted = new Promise((resolve) => { toolAborted = resolve; });
  installLive(t, "abort-ssh", { tools: {
    ls: { execute: async (_id, _input, signal) => {
      toolStarted();
      await new Promise((_resolve, reject) => signal.addEventListener("abort", () => {
        toolAborted();
        reject(new DOMException("aborted", "AbortError"));
      }, { once: true }));
    } },
  } });
  const controller = new AbortController();
  const response = fetch(`${base}/internal/v1/api/agent/abort-ssh/remote-files`, { headers: auth, signal: controller.signal });
  await started;
  controller.abort();
  await assert.rejects(response, /abort/i);
  await aborted;
});
