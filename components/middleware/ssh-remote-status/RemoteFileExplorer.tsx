"use client";
import { useEffect, useState } from "react";
import { useRemoteFiles, type RemoteEntry } from "./useRemoteFiles";
import styles from "./RemoteFileExplorer.module.css";

interface Props {
  sessionId: string;
  remoteCwd: string;
  onOpenFile: (filePath: string, fileName: string) => void;
}

export function RemoteFileExplorer({ sessionId, remoteCwd, onOpenFile }: Props) {
  const { entries, error, list } = useRemoteFiles(sessionId);
  const [expanded, setExpanded] = useState<Set<string>>(new Set(["."]));
  useEffect(() => { void list("."); }, [list]);
  const open = async (parent: string, entry: RemoteEntry) => {
    const value = parent === "." ? entry.name : `${parent}/${entry.name}`;
    if (entry.type === "directory") {
      const next = new Set(expanded);
      if (next.has(value)) next.delete(value); else { next.add(value); await list(value); }
      setExpanded(next); return;
    }
    onOpenFile(value, entry.name);
  };
  const render = (parent: string, depth: number): React.ReactNode => <>{(entries[parent] ?? []).map((entry) => {
    const value = parent === "." ? entry.name : `${parent}/${entry.name}`;
    return <div key={value}><button className={styles.entry} style={{ paddingLeft: 10 + depth * 14 }} onClick={() => void open(parent, entry)}>{entry.type === "directory" ? (expanded.has(value) ? "▾" : "▸") : "·"}<span>{entry.name}</span></button>{entry.type === "directory" && expanded.has(value) && render(value, depth + 1)}</div>;
  })}</>;
  return <div className={styles.root}><div className={styles.toolbar}><span title={remoteCwd}>{remoteCwd}</span><button onClick={() => void list(".")} title="Refresh">↻</button></div>{error && <div className={styles.error}>{error}</div>}<div className={styles.tree}>{render(".", 0)}</div></div>;
}
