export const BACKEND_COOKIE = "pi-web-agent-backend";

export function backendIdFromCookie(cookie: string): string {
  const value = cookie.split(";").map((part) => part.trim()).find((part) => part.startsWith(`${BACKEND_COOKIE}=`))?.slice(BACKEND_COOKIE.length + 1);
  if (value === undefined) return "default";
  return /^(default|[0-9a-f-]{36})$/.test(value) ? value : "invalid";
}

export function getSelectedBackendId(): string {
  return typeof document === "undefined" ? "default" : backendIdFromCookie(document.cookie);
}

export function backendStorageKey(key: string, id = getSelectedBackendId()): string {
  return id === "default" ? key : `${key}:${id}`;
}

export function guardBackendFetch(id: string, send: typeof fetch): typeof fetch {
  return async (input, init) => {
    if (getSelectedBackendId() !== id) throw new Error("Backend selection changed; reload required");
    return send(input, init);
  };
}

export function selectBackend(id: string): void {
  if (!/^(default|[0-9a-f-]{36})$/.test(id)) throw new Error("Invalid backend id");
  document.cookie = `${BACKEND_COOKIE}=${id}; Path=/; SameSite=Strict; Max-Age=31536000${window.location.protocol === "https:" ? "; Secure" : ""}`;
  window.location.assign(window.location.pathname);
}
