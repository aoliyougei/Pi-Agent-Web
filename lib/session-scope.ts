import { getSelectedBackendId } from "./agent-backend-selection";

type StorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem">;
type Options = { backend(): string; storage(): StorageLike | undefined; send: typeof fetch };
const KEY = "pi-web:session-cwd";

/** Browser-only locator hints, never authorization or session-file paths. */
export function createSessionScope(options: Options) {
  const hints = new Map<string, Map<string, string>>();
  const capabilities = new Map<string, Promise<boolean>>();
  const supported = new Set<string>();
  const validating = new Map<string, Promise<string>>();
  const key = (backend: string) => `${KEY}:${backend}`;
  function map(backend = options.backend()) {
    let value = hints.get(backend);
    if (!value) {
      value = new Map();
      try {
        const stored: unknown = JSON.parse(options.storage()?.getItem(key(backend)) ?? "{}");
        if (stored && typeof stored === "object" && !Array.isArray(stored)) {
          for (const [id, cwd] of Object.entries(stored)) if (typeof cwd === "string" && cwd) value.set(id, cwd);
        }
      } catch { /* storage is best-effort */ }
      hints.set(backend, value);
    }
    return value;
  }
  function persist() {
    try { options.storage()?.setItem(key(options.backend()), JSON.stringify(Object.fromEntries(map()))); } catch { /* storage unavailable */ }
  }
  function remember(id: string, cwd: string) {
    if (!id || !cwd || map().get(id) === cwd) return;
    map().set(id, cwd); persist();
  }
  function forget(id: string) { map().delete(id); persist(); }
  const cwd = (id: string) => map().get(id);
  async function enabled() {
    const backend = options.backend();
    let pending = capabilities.get(backend);
    if (!pending) {
      pending = (async () => {
        const response = await options.send("/api/agent/version", { cache: "no-store" });
        if (!response.ok) throw new Error("Cannot determine Agent session discovery support");
        const data = await response.json();
        const result = Array.isArray(data.capabilities) && data.capabilities.includes("project-session-discovery");
        if (result) supported.add(backend);
        return result;
      })();
      capabilities.set(backend, pending);
      pending.catch(() => capabilities.delete(backend));
    }
    return pending;
  }
  async function validate(directory: string) {
    const backend = options.backend();
    const validationKey = JSON.stringify([backend, directory]);
    let pending = validating.get(validationKey);
    if (!pending) {
      pending = (async () => {
        const response = await options.send("/api/cwd/validate", {
          method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ cwd: directory }),
        });
        const data = await response.json();
        if (!response.ok || typeof data.cwd !== "string" || !data.cwd) {
          throw new Error(typeof data.error === "string" ? data.error : data.error?.message ?? `HTTP ${response.status}`);
        }
        if (options.backend() !== backend) throw new Error("Backend selection changed; reload required");
        return data.cwd as string;
      })();
      validating.set(validationKey, pending);
      // Share concurrent checks only: a later request must work after an RPC restart.
      void pending.finally(() => validating.delete(validationKey)).catch(() => {});
    }
    return pending;
  }
  async function prepare(id: string) {
    const backend = options.backend();
    const directory = cwd(id);
    if (!directory || !await enabled()) return undefined;
    if (options.backend() !== backend) throw new Error("Backend selection changed; reload required");
    const normalized = await validate(directory);
    if (options.backend() !== backend) throw new Error("Backend selection changed; reload required");
    remember(id, normalized);
    return normalized;
  }
  function sessionId(url: URL) {
    const match = /^\/api\/(?:sessions|agent|subagents)\/([^/]+)(?:\/|$)/.exec(url.pathname);
    if (match && !["new", "running", "version", "profiles", "settings"].includes(match[1])) return decodeURIComponent(match[1]);
    return url.pathname.startsWith("/api/files/") ? url.searchParams.get("sessionId") ?? undefined : undefined;
  }
  function url(input: string): string {
    if (!supported.has(options.backend())) return input;
    const target = new URL(input, "http://pi-web.local");
    if (target.origin !== "http://pi-web.local") return input;
    const id = sessionId(target);
    const directory = id ? cwd(id) : undefined;
    if (!directory || target.searchParams.has("cwd")) return input;
    target.searchParams.set("cwd", directory);
    return `${target.pathname}${target.search}${target.hash}`;
  }
  const scopedFetch: typeof fetch = async (input, init) => {
    // This helper is used explicitly by Web clients, not installed as a global interceptor.
    if (typeof input !== "string" || !input.startsWith("/api/")) return options.send(input, init);
    const backend = options.backend();
    const target = new URL(input, "http://pi-web.local");
    const id = sessionId(target);
    if (!id) return options.send(input, init);
    const directory = target.searchParams.get("cwd");
    let normalized: string | undefined;
    if (directory && await enabled()) {
      if (options.backend() !== backend) throw new Error("Backend selection changed; reload required");
      normalized = await validate(directory);
    } else normalized = await prepare(id);
    if (options.backend() !== backend) throw new Error("Backend selection changed; reload required");
    let nextInit = init;
    if (normalized) {
      if ((init?.method ?? "GET").toUpperCase() === "POST" && /^\/api\/agent\/[^/]+$/.test(target.pathname)) {
        if (typeof init?.body !== "string") throw new Error("Agent command body must be JSON");
        nextInit = { ...init, body: JSON.stringify({ ...JSON.parse(init.body), cwd: normalized }) };
      } else target.searchParams.set("cwd", normalized);
    }
    return options.send(`${target.pathname}${target.search}`, nextInit);
  };
  return { remember, forget, cwd, enabled, validate, prepare, url, fetch: scopedFetch };
}

export const sessionScope = createSessionScope({
  backend: getSelectedBackendId,
  storage: () => { try { return typeof window === "undefined" ? undefined : window.localStorage; } catch { return undefined; } },
  send: (input, init) => globalThis.fetch(input, init),
});
export async function sessionResponseError(response: Response): Promise<Error> {
  const data = await response.json().catch(() => null);
  const message = typeof data?.error === "string" ? data.error : data?.error?.message;
  return new Error(typeof message === "string" ? message : `HTTP ${response.status}`);
}

export const sessionFetch = sessionScope.fetch;
export const sessionUrl = sessionScope.url;
