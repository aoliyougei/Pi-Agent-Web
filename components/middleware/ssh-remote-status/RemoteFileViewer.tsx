"use client";
import { useEffect, useState } from "react";
import { useRemoteFiles } from "./useRemoteFiles";

interface Props { sessionId: string; filePath: string }

export function RemoteFileViewer({ sessionId, filePath }: Props) {
  const { read } = useRemoteFiles(sessionId);
  const [file, setFile] = useState<Awaited<ReturnType<typeof read>> | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let active = true;
    setFile(null); setError(null);
    void read(filePath).then((value) => { if (active) setFile(value); }).catch((reason) => { if (active) setError(reason instanceof Error ? reason.message : String(reason)); });
    return () => { active = false; };
  }, [filePath, read]);
  return <div style={{ display: "flex", flexDirection: "column", height: "100%", overflow: "hidden" }}>
    <div style={{ padding: "6px 16px", borderBottom: "1px solid var(--border)", fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--text-dim)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={filePath}>{filePath} · SSH read-only</div>
    <div style={{ flex: 1, overflow: "auto", padding: 16 }}>
      {error ? <div style={{ color: "var(--error)" }}>{error}</div> : !file ? <div style={{ color: "var(--text-dim)" }}>Loading…</div> : file.type === "text" ? <pre style={{ margin: 0, fontFamily: "var(--font-mono)", fontSize: 13, lineHeight: 1.6, whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{file.text}</pre> : <div role="img" aria-label={filePath} style={{ backgroundImage: `url(data:${file.mimeType};base64,${file.data})`, backgroundSize: "contain", backgroundRepeat: "no-repeat", backgroundPosition: "center", width: "100%", minHeight: "100%" }} />}
    </div>
  </div>;
}
