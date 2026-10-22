import { backendStorageKey } from "../../agent-backend-selection";
import { isWorkspaceWithin } from "../../workspace-selection";

const STORAGE_KEY = "pi-web:local-workspaces-v1";
const MAX_WORKSPACES = 50;
interface StorageLike { getItem(key: string): string | null; setItem(key: string, value: string): void }
function browserStorage(): StorageLike | null { try { return typeof window === "undefined" ? null : window.localStorage; } catch { return null; } }
export function loadLocalWorkspaces(storage: StorageLike | null = browserStorage()): string[] {
  if (!storage) return [];
  try {
    const value: unknown = JSON.parse(storage.getItem(backendStorageKey(STORAGE_KEY)) ?? "[]");
    return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string" && item.length > 0).slice(0, MAX_WORKSPACES) : [];
  } catch { return []; }
}
export function removeLocalWorkspace(path: string, storage: StorageLike | null = browserStorage()): string[] {
  const next = loadLocalWorkspaces(storage).filter(item => !isWorkspaceWithin(item, path));
  try { storage?.setItem(backendStorageKey(STORAGE_KEY), JSON.stringify(next)); } catch { /* best effort */ }
  return next;
}
export function saveLocalWorkspace(path: string, storage: StorageLike | null = browserStorage()): string[] {
  const normalized = path.trim(); if (!normalized) return loadLocalWorkspaces(storage);
  const next = [normalized, ...loadLocalWorkspaces(storage).filter((item) => item !== normalized)].slice(0, MAX_WORKSPACES);
  try { storage?.setItem(backendStorageKey(STORAGE_KEY), JSON.stringify(next)); } catch { /* best effort */ }
  return next;
}
