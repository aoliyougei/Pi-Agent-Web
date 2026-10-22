"use client";
import { sessionFetch as fetch } from "@/lib/session-scope";
import { useCallback, useState } from "react";
export type RemoteEntry = { name: string; type: "file" | "directory" };
export function useRemoteFiles(sessionId: string) {
  const [entries, setEntries] = useState<Record<string, RemoteEntry[]>>({});
  const [error, setError] = useState<string | null>(null);
  const list = useCallback(async (path = ".") => {
    const response = await fetch(`/api/agent/${encodeURIComponent(sessionId)}/remote-files?path=${encodeURIComponent(path)}`, { cache: "no-store" });
    const data = await response.json();
    if (!response.ok) { setError(data.error ?? `HTTP ${response.status}`); return []; }
    setError(null); setEntries((value) => ({ ...value, [path]: data.entries ?? [] })); return data.entries ?? [];
  }, [sessionId]);
  const read = useCallback(async (path: string) => {
    const response = await fetch(`/api/agent/${encodeURIComponent(sessionId)}/remote-file?path=${encodeURIComponent(path)}`, { cache: "no-store" });
    const data = await response.json(); if (!response.ok) throw new Error(data.error ?? `HTTP ${response.status}`); return data.file;
  }, [sessionId]);
  return { entries, error, list, read };
}
