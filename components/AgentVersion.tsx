"use client";

import { useEffect, useState } from "react";
import { useI18n } from "@/hooks/useI18n";

export function AgentVersion() {
  const { t } = useI18n();
  const [version, setVersion] = useState<{ serverVersion: string; piVersion: string } | null>(null);
  useEffect(() => {
    let controller: AbortController | undefined;
    function refresh() {
      controller?.abort();
      controller = new AbortController();
      const signal = controller.signal;
      void fetch("/api/agent/version", { cache: "no-store", signal })
        .then(async (response) => {
          if (!response.ok) throw new Error();
          const data = await response.json();
          if (typeof data.serverVersion !== "string" || typeof data.piVersion !== "string") throw new Error();
          if (!signal.aborted) setVersion(data);
        }).catch(() => { if (!signal.aborted) setVersion(null); });
    }
    refresh();
    const timer = window.setInterval(refresh, 30000);
    window.addEventListener("focus", refresh);
    return () => { controller?.abort(); window.clearInterval(timer); window.removeEventListener("focus", refresh); };
  }, []);
  return <span style={{ fontSize: 11, color: "var(--text-muted)" }} title={version ? `Pi v${version.piVersion}` : undefined}>
    pi-agent-rpc <span style={{ color: "var(--text)" }}>{version ? `v${version.serverVersion}` : t("backends.versionUnknown")}</span>
  </span>;
}
