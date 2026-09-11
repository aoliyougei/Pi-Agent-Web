import fs from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import { homedir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { SessionManager, VERSION } from "@earendil-works/pi-coding-agent";
import type { installSessionManagerLocks } from "./session-manager-lock.js";

let installed = false;

/** Guard upstream's synchronous fork allocation without copying its serialization logic. */
export function installSessionForkLocks(guard: ReturnType<typeof installSessionManagerLocks>) {
  if (VERSION !== "0.84.4" || typeof SessionManager.forkFrom !== "function") throw new Error("Unsupported Pi fork boundary");
  if (installed) throw new Error("Session fork locks are already installed");
  const original = SessionManager.forkFrom;
  SessionManager.forkFrom = function (...args) {
    const input = args[0];
    const source = input === "~" ? homedir() : input.startsWith("~/") ? join(homedir(), input.slice(2))
      : input.startsWith("file://") ? fileURLToPath(input) : input;
    const releaseSource = guard.reserveFile(source);
    const write = fs.writeFileSync;
    let releaseTarget: (() => void) | undefined;
    try {
      // No await/callback enters user code in Pi 0.84.4 forkFrom. Restore immediately
      // after the synchronous call; never leave a process-wide fs hook installed.
      fs.writeFileSync = function (file, ...writeArgs) {
        // Lease metadata writes use an already-open descriptor, not a Session path.
        if (typeof file === "number") return write.call(this, file, ...writeArgs);
        if (!releaseTarget) {
          if (typeof file !== "string") throw new Error("Unsupported Pi fork target");
          releaseTarget = guard.reserveFile(file);
        }
        return write.call(this, file, ...writeArgs);
      };
      syncBuiltinESMExports();
      return original.apply(this, args);
    } finally {
      fs.writeFileSync = write;
      syncBuiltinESMExports();
      releaseTarget?.();
      releaseSource();
    }
  };
  installed = true;
  let removed = false;
  return () => {
    if (removed) return;
    removed = true;
    SessionManager.forkFrom = original;
    installed = false;
  };
}
