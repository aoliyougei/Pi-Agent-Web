import { randomUUID } from "node:crypto";
import { PROTOCOL_VERSION } from "@aoliyougei/pi-agent-contract";

const STRIPPED_HEADERS = ["authorization", "cookie", "host", "connection", "keep-alive", "proxy-authenticate", "proxy-authorization", "te", "trailer", "transfer-encoding", "upgrade"];

export class AgentRpcError extends Error {
  readonly code = "agent_unavailable";

  constructor() {
    super("Agent service unavailable");
  }
}

export function createAgentClient(options: { baseUrl: string; token: string }) {
  const base = new URL(options.baseUrl);
  if (!["http:", "https:"].includes(base.protocol) || base.username || base.password || base.pathname !== "/" || base.search || base.hash) {
    throw new Error("Invalid agent RPC URL");
  }
  return {
    async fetch(path: string, init: RequestInit = {}): Promise<Response> {
      const target = new URL(path, base);
      if (!path.startsWith("/internal/v1/") || target.origin !== base.origin || !target.pathname.startsWith("/internal/v1/")) {
        throw new Error("Invalid agent RPC path");
      }
      const headers = new Headers(init.headers);
      for (const name of STRIPPED_HEADERS) headers.delete(name);
      headers.set("authorization", `Bearer ${options.token}`);
      headers.set("x-pi-agent-protocol", String(PROTOCOL_VERSION));
      if (!headers.has("x-request-id")) headers.set("x-request-id", randomUUID());
      try {
        return await fetch(target, { ...init, headers, redirect: "manual" });
      } catch {
        throw new AgentRpcError();
      }
    },
  };
}
