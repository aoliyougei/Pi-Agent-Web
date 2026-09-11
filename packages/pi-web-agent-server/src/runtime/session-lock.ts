import { createHash } from "node:crypto";
import { closeSync, constants, fstatSync, ftruncateSync, mkdirSync, openSync, realpathSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { flockSync } from "fs-ext";

// Resolve existing ancestors too: a newly allocated Session file may not exist yet.
function canonicalPath(path: string): string {
  try { return realpathSync(path); } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    const parent = dirname(path);
    if (parent === path) throw error;
    return join(canonicalPath(parent), basename(path));
  }
}

export class SessionLockedError extends Error {
  readonly code = "session_locked";
  readonly status = 409;
  constructor() { super("Session is already owned by another CLI or RPC runtime"); }
}

export function acquireSessionLock(sessionFile: string, lockDirectory: string, owner: string) {
  const canonical = canonicalPath(resolve(sessionFile));
  mkdirSync(lockDirectory, { recursive: true, mode: 0o700 });
  const path = join(lockDirectory, `${createHash("sha256").update(canonical).digest("hex")}.lock`);
  const fd = openSync(path, constants.O_CREAT | constants.O_RDWR | constants.O_NOFOLLOW, 0o600);
  try {
    if (!fstatSync(fd).isFile()) throw new Error("Session lock must be a regular file");
    try { flockSync(fd, "exnb"); } catch (error) {
      if (["EAGAIN", "EWOULDBLOCK"].includes((error as NodeJS.ErrnoException).code ?? "")) throw new SessionLockedError();
      throw error;
    }
    // Informational only. Never unlink this inode: stale contents do not imply a stale lock.
    ftruncateSync(fd, 0);
    writeFileSync(fd, JSON.stringify({ owner, pid: process.pid, startedAt: new Date().toISOString() }));
  } catch (error) {
    closeSync(fd);
    throw error;
  }
  let released = false;
  return {
    path,
    release() {
      if (released) return;
      released = true;
      closeSync(fd);
    },
  };
}
