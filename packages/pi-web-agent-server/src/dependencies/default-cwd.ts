import { isAbsolute, join, normalize } from "node:path";

export const DEFAULT_CWD_ROOT = "/app/pi-cwd";

export function resolveDefaultCwdRoot(value: string | undefined): string {
  const root = value?.trim() || DEFAULT_CWD_ROOT;
  if (!isAbsolute(root)) throw new Error("PI_WEB_DEFAULT_CWD_ROOT must be an absolute path");
  return normalize(root);
}

export function defaultCwdPath(date: Date, configuredRoot: string | undefined): string {
  const day = date.toISOString().slice(0, 10).replace(/-/g, "");
  return join(resolveDefaultCwdRoot(configuredRoot), `pi-cwd-${day}`);
}
