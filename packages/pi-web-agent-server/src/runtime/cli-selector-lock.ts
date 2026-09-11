import { SessionSelectorComponent } from "@earendil-works/pi-coding-agent";
import { acquireSessionLock } from "./session-lock.js";
import type { installSessionManagerLocks } from "./session-manager-lock.js";

type Guard = ReturnType<typeof installSessionManagerLocks>;
type Selector = {
  sessionList: { onDeleteSession?: (path: string) => Promise<void>; onError?: (message: string) => void };
  renameSession?: (path: string, name?: string) => Promise<void>;
};
const guarded = new WeakSet<object>();
export function guardSessionSelector(selector: Selector, guard: Guard, directory: string) {
  if (guarded.has(selector)) return;
  guarded.add(selector);
  const remove = selector.sessionList.onDeleteSession;
  if (remove) selector.sessionList.onDeleteSession = async (path) => {
    // Deletion must conflict even with another manager in this same CLI process.
    try {
      const lease = acquireSessionLock(path, directory, "cli-delete");
      try { await remove(path); } finally { lease.release(); }
    } catch (error) {
      // Upstream dispatches deletion with void, so surface conflicts in the selector.
      if (selector.sessionList.onError) selector.sessionList.onError(error instanceof Error ? error.message : "Session deletion failed");
      else throw error;
    }
  };
  const rename = selector.renameSession;
  if (rename) selector.renameSession = (path, name) => guard.withManagerScope(() => rename(path, name), () => undefined);
}

export function installSessionSelectorLocks(guard: Guard, directory: string) {
  const original = SessionSelectorComponent.prototype.handleInput;
  SessionSelectorComponent.prototype.handleInput = function (data) {
    guardSessionSelector(this as unknown as Selector, guard, directory);
    original.call(this, data);
  };
}
