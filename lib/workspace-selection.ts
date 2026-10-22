export function isWorkspaceWithin(candidate: string, root: string): boolean {
  const normalize = (value: string) => {
    const windows = /^[a-z]:[\\/]/i.test(value) || value.startsWith("\\\\");
    const path = (windows ? value.replace(/\\/g, "/").toLowerCase() : value).replace(/\/+$/, "");
    return path;
  };
  const path = normalize(candidate), parent = normalize(root);
  return path === parent || path.startsWith(`${parent}/`);
}

export function isMissingWorkspace(error: unknown): boolean {
  return error instanceof Error && /^Directory does not exist(?::|$)/.test(error.message);
}

export async function validateWorkspace(directory: string, send: typeof fetch = globalThis.fetch) {
  const response = await send("/api/cwd/validate", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ cwd: directory }),
  });
  const data = await response.json().catch(() => null);
  if (!response.ok || typeof data?.cwd !== "string" || typeof data.projectRoot !== "string" || typeof data.projectKey !== "string") {
    const message = typeof data?.error === "string" ? data.error : data?.error?.message;
    throw new Error(typeof message === "string" ? message : `HTTP ${response.status}`);
  }
  return { cwd: data.cwd as string, root: data.projectRoot as string, key: data.projectKey as string };
}
