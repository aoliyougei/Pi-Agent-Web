import { AgentSessionRuntime, VERSION } from "@earendil-works/pi-coding-agent";
import type { installSessionManagerLocks } from "./session-manager-lock.js";

type Method = (this: AgentSessionRuntime, ...args: unknown[]) => Promise<unknown>;
let installed = false;

/** SDK lifecycle interception only; installation is deferred until CLI/RPC acceptance. */
export function installSessionRuntimeLocks(guard: ReturnType<typeof installSessionManagerLocks>) {
  const prototype = AgentSessionRuntime.prototype as unknown as Record<string, Method>;
  const names = ["switchSession", "newSession", "fork", "importFromJsonl", "teardownCurrent", "dispose"];
  if (VERSION !== "0.84.4" || names.some((name) => typeof prototype[name] !== "function")) {
    throw new Error("Unsupported Pi Runtime lifecycle boundary");
  }
  if (installed) throw new Error("Runtime locks are already installed");
  const originals = new Map(names.map((name) => [name, prototype[name]]));
  for (const name of names) {
    const original = originals.get(name)!;
    prototype[name] = async function (...args) {
      if (name === "teardownCurrent" || name === "dispose") {
        const manager = this.session.sessionManager;
        const result = await original.apply(this, args);
        // Do not unlock before extension shutdown/disposal has actually completed.
        guard.release(manager);
        return result;
      }
      return guard.withManagerScope(() => original.apply(this, args), () => this.session.sessionManager);
    };
  }
  installed = true;
  let removed = false;
  return () => {
    if (removed) return;
    removed = true;
    for (const [name, method] of originals) prototype[name] = method;
    installed = false;
  };
}
