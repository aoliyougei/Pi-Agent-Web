import assert from "node:assert/strict";
import fs from "node:fs";
import { tmpdir } from "node:os";
import { syncBuiltinESMExports } from "node:module";
import { join } from "node:path";
import test from "node:test";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { acquireSessionLock } from "../dist/runtime/session-lock.js";

test("RPC empty fork is persisted, reopenable, and releases only its target",  async (t) => {
  const { copyRpcSession } = await import("../dist/runtime/session-copy.js");
  const dir = fs.mkdtempSync(join(tmpdir(), "rpc-copy-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const manager = SessionManager.create(dir, dir);
  const source = manager.getSessionFile();
  fs.writeFileSync(source, JSON.stringify(manager.getHeader()) + "\n");
  const locks = join(dir, "locks");
  const held = acquireSessionLock(source, locks, "rpc");
  t.after(() => held.release());
  const result = copyRpcSession(source, undefined, locks);
  const reopened = SessionManager.open(result.file);
  assert.equal(reopened.getSessionId(), result.id);
  assert.equal(reopened.getHeader().parentSession, source);
  acquireSessionLock(result.file, locks, "cli").release();
  const leaf = SessionManager.open(source).appendMessage({ role: "assistant", content: [], api: "test", provider: "test", model: "test", usage: {}, stopReason: "stop", timestamp: Date.now() });
  const open = fs.openSync;
  let sawProtectedWrite = false;
  fs.openSync = function (path, flags, ...args) {
    if (flags === "w" && typeof path === "string" && path.endsWith(".jsonl") && path !== source) {
      assert.throws(() => acquireSessionLock(path, locks, "cli"), { code: "session_locked" });
      sawProtectedWrite = true;
    }
    return open.call(this, path, flags, ...args);
  };
  syncBuiltinESMExports();
  let clone;
  try { clone = copyRpcSession(source, leaf, locks); }
  finally { fs.openSync = open; syncBuiltinESMExports(); }
  assert.equal(sawProtectedWrite, true);
  assert.equal(SessionManager.open(clone.file).getBranch().some((entry) => entry.type === "message"), true);
  acquireSessionLock(clone.file, locks, "cli").release();
  assert.throws(() => acquireSessionLock(source, locks, "cli"), { code: "session_locked" });
});
