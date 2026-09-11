import { getAgentDir, SessionManager, VERSION } from "@earendil-works/pi-coding-agent";
import { join } from "node:path";
import { installSessionManagerLocks } from "./session-manager-lock.js";
import { installSessionImportLocks } from "./session-import-lock.js";
import { installSessionForkLocks } from "./session-fork-lock.js";
import { installSessionRuntimeLocks } from "./session-runtime-lock.js";

// Explicit node --import only: do not propagate this through NODE_OPTIONS to tools.
// Install Runtime last so its manager scope surrounds the import destination lease.
const guard = installSessionManagerLocks(SessionManager, {
  directory: join(getAgentDir(), "locks", "sessions"),
  owner: "cli",
  piVersion: VERSION,
});
installSessionImportLocks(guard);
installSessionForkLocks(guard);
installSessionRuntimeLocks(guard);
// The kernel releases descriptors on every process exit, including SIGKILL.
