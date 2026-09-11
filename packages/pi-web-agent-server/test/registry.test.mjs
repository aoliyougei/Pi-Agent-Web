import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, {
  interopDefault: true,
  moduleCache: false,
});
const { getRpcSessionInfos, RuntimeRegistry } = await jiti.import("../src/runtime/registry.ts");
const { SessionRuntime } = await jiti.import("../src/runtime/session-runtime.ts");

test("destroys an extracted SessionRuntime through the registry contract", async () => {
  let disposed = false;
  const runtime = new SessionRuntime({
    sessionId: "real-runtime",
    sessionManager: { getCwd: () => "/tmp" },
    agent: { state: {} },
    extensionRunner: {},
    isStreaming: false,
    isCompacting: false,
    isBashRunning: false,
    dispose: () => { disposed = true; },
  });
  const registry = new RuntimeRegistry();

  await registry.start("real-runtime", async () => runtime);
  await registry.destroy("real-runtime");

  assert.equal(disposed, true);
  assert.equal(registry.get("real-runtime"), undefined);
});

test("shares one startup promise and tracks only running runtimes", async () => {
  const registry = new RuntimeRegistry();
  let starts = 0;
  let release;
  const held = new Promise((resolve) => { release = resolve; });
  const runtime = { isRunning: () => true, close: async () => {} };
  const factory = async () => { starts += 1; await held; return runtime; };
  const first = registry.start("same", factory);
  const second = registry.start("same", factory);
  assert.equal(starts, 1);
  release();
  assert.equal(await first, runtime);
  assert.equal(await second, runtime);
  assert.deepEqual(registry.listRunning(), ["same"]);
  await registry.destroy("same");
  assert.equal(registry.get("same"), undefined);
});

function makeRuntimeSession({ id, filePath, running, entries }) {
  const timestamp = "2026-08-12T01:02:03.000Z";
  const manager = {
    getHeader: () => ({ type: "session", id, cwd: "/tmp/runtime-cwd", timestamp }),
    getEntries: () => entries,
    getSessionFile: () => filePath,
    getSessionName: () => undefined,
  };
  return {
    isAlive: () => true,
    isRunning: () => running,
    inner: { sessionManager: manager },
    get sessionId() { return id; },
    get sessionFile() { return filePath; },
    get cwd() { return "/tmp/runtime-cwd"; },
  };
}

test("lists an accepted new prompt before its session file exists", (t) => {
  const previousRegistry = globalThis.__piAgentServerSessions;
  const timestamp = "2026-08-12T01:02:04.000Z";
  const visible = makeRuntimeSession({
    id: "visible-runtime",
    filePath: join(tmpdir(), "pi-web-missing-runtime-session.jsonl"),
    running: true,
    entries: [{
      type: "message",
      id: "u1",
      parentId: null,
      timestamp,
      message: {
        role: "user",
        content: [{ type: "text", text: "first" }, { type: "text", text: "prompt" }],
      },
    }],
  });
  const emptyEnsureSession = makeRuntimeSession({
    id: "empty-runtime",
    filePath: join(tmpdir(), "pi-web-missing-empty-session.jsonl"),
    running: false,
    entries: [],
  });
  globalThis.__piAgentServerSessions = new Map([
    ["visible-runtime", visible],
    ["empty-runtime", emptyEnsureSession],
  ]);
  t.after(() => {
    globalThis.__piAgentServerSessions = previousRegistry;
  });

  const infos = getRpcSessionInfos();

  assert.equal(infos.length, 1);
  assert.equal(infos[0].id, "visible-runtime");
  assert.equal(infos[0].firstMessage, "first prompt");
  assert.equal(infos[0].messageCount, 1);
  assert.equal(infos[0].transient, true);
});

test("keeps an idle runtime visible once its JSONL file exists", (t) => {
  const previousRegistry = globalThis.__piAgentServerSessions;
  const dir = mkdtempSync(join(tmpdir(), "pi-web-runtime-session-"));
  const filePath = join(dir, "session.jsonl");
  writeFileSync(filePath, "persisted\n");
  globalThis.__piAgentServerSessions = new Map([["persisted-runtime", makeRuntimeSession({
    id: "persisted-runtime",
    filePath,
    running: false,
    entries: [],
  })]]);
  t.after(() => {
    globalThis.__piAgentServerSessions = previousRegistry;
    rmSync(dir, { recursive: true, force: true });
  });

  const infos = getRpcSessionInfos();

  assert.equal(infos.length, 1);
  assert.equal(infos[0].transient, false);
});
