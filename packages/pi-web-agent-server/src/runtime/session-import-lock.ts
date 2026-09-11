import { AgentSessionRuntime, VERSION } from "@earendil-works/pi-coding-agent";
import { homedir } from "node:os";
import { basename, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { installSessionManagerLocks } from "./session-manager-lock.js";

let installed = false;

/** Hold the destination before upstream import copies bytes, including across async hooks. */
export function installSessionImportLocks(guard: ReturnType<typeof installSessionManagerLocks>) {
  if (VERSION !== "0.84.4" || typeof AgentSessionRuntime.prototype.importFromJsonl !== "function") {
    throw new Error("Unsupported Pi import boundary");
  }
  if (installed) throw new Error("Session import locks are already installed");
  const original = AgentSessionRuntime.prototype.importFromJsonl;
  AgentSessionRuntime.prototype.importFromJsonl = function (input, cwdOverride) {
    // Same Linux normalization as Pi's resolvePath, without resolving symlink basenames.
    const path = input === "~" ? homedir() : input.startsWith("~/") ? join(homedir(), input.slice(2))
      : input.startsWith("file://") ? fileURLToPath(input) : input;
    const destination = join(this.session.sessionManager.getSessionDir(), basename(resolve(path)));
    return guard.withFileLease(destination, () => original.call(this, input, cwdOverride));
  };
  installed = true;
  let removed = false;
  return () => {
    if (removed) return;
    removed = true;
    AgentSessionRuntime.prototype.importFromJsonl = original;
    installed = false;
  };
}
