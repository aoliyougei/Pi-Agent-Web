import { AsyncLocalStorage } from "node:async_hooks";
import { homedir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { SessionManager, VERSION } from "@earendil-works/pi-coding-agent";
import { acquireSessionLock, canonicalSessionPath, SessionLockedError } from "./session-lock.js";

interface Manager {
  getSessionFile(): string | undefined;
  isPersisted(): boolean;
}
type Method = (this: Manager, ...args: unknown[]) => unknown;
type Lease = ReturnType<typeof acquireSessionLock> & { users: number };

// Pi 0.84.4 mutates these containers in place when replacing the current branch.
// Snapshot only container structure, not the potentially large message payloads.
function snapshot(manager: Manager) {
  const state = Object.fromEntries(Object.entries(manager).map(([key, value]) => [key,
    value instanceof Map ? new Map(value) : Array.isArray(value) ? [...value] : value,
  ]));
  return () => Object.assign(manager, state);
}

/** Version-bound interception, not upstream source changes. Not enabled by importing this module. */
export function installSessionManagerLocks(
  managerClass: { prototype: Manager },
  options: { directory: string; owner: string; piVersion: string },
) {
  if (VERSION !== "0.84.4" || options.piVersion !== VERSION || managerClass !== SessionManager) {
    throw new Error("Unsupported Pi SessionManager version or class");
  }
  const prototype = managerClass.prototype as unknown as Record<string, Method>;
  const names = ["_setSessionFile", "newSession", "createBranchedSession", "_appendEntry", "_rewriteFile", "_persist"] as const;
  const originals = new Map(names.map((name) => [name, prototype[name]]));
  for (const name of names) {
    if (typeof prototype[name] !== "function") throw new Error(`Unsupported SessionManager boundary: ${name}`);
  }
  if (installed.has(managerClass)) throw new Error("SessionManager locks are already installed");
  const leases = new Map<string, Lease>();
  const managers = new Map<Manager, string>();
  const acquisitions = new AsyncLocalStorage<Set<Manager>>();
  const opening = new Set<Manager>();
  const fileOperations = new Set<string>();
  const retain = (path: string) => {
    const key = canonicalSessionPath(path);
    let lease = leases.get(key);
    if (!lease) {
      lease = { ...acquireSessionLock(key, options.directory, options.owner), users: 0 };
      leases.set(key, lease);
    }
    lease.users += 1;
    return key;
  };
  const drop = (key: string) => {
    const lease = leases.get(key)!;
    if (--lease.users === 0) { lease.release(); leases.delete(key); }
  };
  const release = (manager: Manager) => {
    const key = managers.get(manager);
    if (key !== undefined) { managers.delete(manager); drop(key); }
  };
  const adopt = (manager: Manager, key: string) => {
    if (!managers.has(manager)) acquisitions.getStore()?.add(manager);
    release(manager);
    managers.set(manager, key);
  };
  prototype._setSessionFile = function (...args) {
    if (typeof args[0] !== "string") throw new Error("Invalid Session file");
    const restore = snapshot(this);
    // Match Pi's Linux path normalization before selecting the shared lock inode.
    const input = args[0];
    const path = input === "~" ? homedir() : input.startsWith("~/") ? join(homedir(), input.slice(2))
      : input.startsWith("file://") ? fileURLToPath(input) : input;
    const key = retain(path); // Before empty-file initialization or migration writes.
    opening.add(this);
    try {
      const result = originals.get("_setSessionFile")!.apply(this, args);
      adopt(this, key);
      return result;
    } catch (error) { restore(); drop(key); throw error; }
    finally { opening.delete(this); }
  };
  prototype.newSession = function (...args) {
    const restore = snapshot(this);
    try {
      const result = originals.get("newSession")!.apply(this, args);
      const file = this.getSessionFile();
      // _setSessionFile invokes newSession internally, then restores its explicit path.
      if (!opening.has(this) && this.isPersisted() && file) adopt(this, retain(file));
      return result;
    } catch (error) { restore(); throw error; }
  };
  prototype.createBranchedSession = function (...args) {
    const restore = snapshot(this);
    const previous = this.isPersisted() ? this.getSessionFile() : undefined;
    // Retain source across _rewriteFile's target adoption, including write failures.
    const sourceKey = previous ? retain(previous) : undefined;
    try {
      const result = originals.get("createBranchedSession")!.apply(this, args);
      const file = this.getSessionFile();
      if (this.isPersisted() && file && managers.get(this) !== canonicalSessionPath(file)) adopt(this, retain(file));
      return result;
    } catch (error) {
      restore();
      if (sourceKey) adopt(this, retain(sourceKey));
      throw error;
    } finally { if (sourceKey) drop(sourceKey); }
  };
  for (const name of ["_appendEntry", "_rewriteFile", "_persist"] as const) {
    prototype[name] = function (...args) {
      const file = this.getSessionFile();
      if (!opening.has(this) && this.isPersisted() && file) {
        const key = canonicalSessionPath(file);
        if (managers.get(this) !== key) adopt(this, retain(file));
      }
      return originals.get(name)!.apply(this, args);
    };
  }
  installed.add(managerClass);
  return {
    release,
    reserveFile(file: string) {
      const key = retain(file);
      let released = false;
      return () => { if (!released) { released = true; drop(key); } };
    },
    async withManagerScope<T>(operation: () => Promise<T>, keep: () => Manager): Promise<T> {
      const created = new Set<Manager>();
      return acquisitions.run(created, async () => {
        try { return await operation(); }
        finally {
          const active = keep();
          for (const manager of created) if (manager !== active) release(manager);
        }
      });
    },
    async withFileLease<T>(file: string, operation: () => Promise<T>): Promise<T> {
      const canonical = canonicalSessionPath(file);
      if (fileOperations.has(canonical)) throw new SessionLockedError();
      const key = retain(canonical);
      fileOperations.add(key);
      try { return await operation(); }
      finally { fileOperations.delete(key); drop(key); }
    },
    uninstall() {
      for (const [name, method] of originals) prototype[name] = method;
      for (const manager of managers.keys()) release(manager);
      installed.delete(managerClass);
    },
  };
}

const installed = new WeakSet<object>();
