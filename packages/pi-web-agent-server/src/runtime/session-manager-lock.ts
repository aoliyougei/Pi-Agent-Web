import { acquireSessionLock, canonicalSessionPath } from "./session-lock.js";

interface Manager {
  getSessionFile(): string | undefined;
  isPersisted(): boolean;
}
type Method = (this: Manager, ...args: unknown[]) => unknown;
type Lease = ReturnType<typeof acquireSessionLock> & { users: number };

/** Version-bound interception, not upstream source changes. Not enabled by importing this module. */
export function installSessionManagerLocks(
  managerClass: { prototype: Manager },
  options: { directory: string; owner: string; piVersion: string },
) {
  if (options.piVersion !== "0.84.4") throw new Error("Unsupported Pi SessionManager version");
  const prototype = managerClass.prototype as unknown as Record<string, Method>;
  const names = ["_setSessionFile", "newSession", "_appendEntry", "_rewriteFile", "_persist"] as const;
  const originals = new Map(names.map((name) => [name, prototype[name]]));
  for (const name of names) {
    if (typeof prototype[name] !== "function") throw new Error(`Unsupported SessionManager boundary: ${name}`);
  }
  if (installed.has(managerClass)) throw new Error("SessionManager locks are already installed");
  const leases = new Map<string, Lease>();
  const managers = new Map<Manager, string>();
  const opening = new Set<Manager>();
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
    release(manager);
    managers.set(manager, key);
  };
  prototype._setSessionFile = function (...args) {
    if (typeof args[0] !== "string") throw new Error("Invalid Session file");
    const key = retain(args[0]); // Before empty-file initialization or migration writes.
    opening.add(this);
    try {
      const result = originals.get("_setSessionFile")!.apply(this, args);
      adopt(this, key);
      return result;
    } catch (error) { drop(key); throw error; }
    finally { opening.delete(this); }
  };
  prototype.newSession = function (...args) {
    const result = originals.get("newSession")!.apply(this, args);
    const file = this.getSessionFile();
    // _setSessionFile invokes newSession internally, then restores its explicit path.
    if (!opening.has(this) && this.isPersisted() && file) adopt(this, retain(file));
    return result;
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
    uninstall() {
      for (const [name, method] of originals) prototype[name] = method;
      for (const manager of managers.keys()) release(manager);
      installed.delete(managerClass);
    },
  };
}

const installed = new WeakSet<object>();
