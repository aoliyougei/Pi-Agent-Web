import type { AgentFetch } from "./proxy";
import { checkAgentCompatibility } from "./version-check";

export function createAgentVersionRoute(send: AgentFetch) {
  return async () => {
    const headers = { "Cache-Control": "no-store" };
    try {
      const response = await send("/internal/v1/version", { signal: AbortSignal.timeout(5000) });
      if (!response.ok) throw new Error();
      return Response.json(checkAgentCompatibility(await response.json()), { headers });
    } catch {
      return Response.json({ error: "Agent version unavailable" }, { status: 503, headers });
    }
  };
}
