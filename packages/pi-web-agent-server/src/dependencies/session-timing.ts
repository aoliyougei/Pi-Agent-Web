interface TimingEntry {
  type: string;
  timestamp: string;
  message?: { role?: string };
}

export function computeSessionTotalActiveMs(entries: readonly TimingEntry[]): number {
  let totalActiveMs = 0;
  let previousTimestamp: number | undefined;
  for (const entry of entries) {
    if (!isTimingEntry(entry.type)) continue;
    const timestamp = Date.parse(entry.timestamp);
    if (!Number.isFinite(timestamp)) continue;
    const role = entry.type === "message" ? entry.message?.role : undefined;
    if (role === "user" || role === "bashExecution") {
      previousTimestamp = timestamp;
      continue;
    }
    if (previousTimestamp !== undefined && timestamp > previousTimestamp) totalActiveMs += timestamp - previousTimestamp;
    previousTimestamp = timestamp;
  }
  return totalActiveMs;
}

function isTimingEntry(type: string): boolean {
  return type === "message" || type === "compaction" || type === "branch_summary" || type === "custom_message";
}
