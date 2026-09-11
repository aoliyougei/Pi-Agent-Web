import fs from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import { dirname } from "node:path";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { acquireSessionLock } from "./session-lock.js";

/** Caller owns source. Keep the generated destination locked through all synchronous writes. */
export function copyRpcSession(source: string, leaf: string | undefined, locks: string) {
  const manager = SessionManager.open(source);
  let lease: ReturnType<typeof acquireSessionLock> | undefined;
  const open = fs.openSync;
  try {
    if (leaf === undefined) {
      const empty = SessionManager.create(manager.getCwd(), dirname(source));
      empty.newSession({ parentSession: source });
      const file = empty.getSessionFile()!;
      lease = acquireSessionLock(file, locks, "rpc-copy");
      fs.writeFileSync(file, JSON.stringify(empty.getHeader()) + "\n", { flag: "wx" });
      return { file, id: empty.getSessionId() };
    }
    // Same synchronous boundary as upstream createBranchedSession; no async/user callbacks.
    fs.openSync = function (file, flags, ...args) {
      if (flags === "w" && typeof file === "string" && file !== source && !lease) {
        lease = acquireSessionLock(file, locks, "rpc-copy");
      }
      return open.call(this, file, flags, ...args);
    };
    syncBuiltinESMExports();
    const file = manager.createBranchedSession(leaf);
    if (!file) throw new Error("Failed to copy Session");
    if (!lease) lease = acquireSessionLock(file, locks, "rpc-copy");
    if (!fs.existsSync(file)) {
      fs.writeFileSync(file, [manager.getHeader(), ...manager.getEntries()].map((entry) => JSON.stringify(entry)).join("\n") + "\n", { flag: "wx" });
    }
    return { file, id: manager.getSessionId() };
  } finally {
    fs.openSync = open;
    syncBuiltinESMExports();
    lease?.release();
  }
}
