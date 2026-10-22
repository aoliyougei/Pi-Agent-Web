export const PROTOCOL_VERSION = 1 as const;

export interface AgentVersion {
  protocolVersion: typeof PROTOCOL_VERSION;
  serverVersion: string;
  piVersion: string;
  piRevision: string;
  capabilities: string[];
}

export function parseAgentVersion(value: unknown): AgentVersion {
  if (!value || typeof value !== "object") throw new Error("Invalid agent version");
  const candidate = value as Record<string, unknown>;
  if (
    candidate.protocolVersion !== PROTOCOL_VERSION
    || typeof candidate.serverVersion !== "string"
    || typeof candidate.piVersion !== "string"
    || typeof candidate.piRevision !== "string"
    || !Array.isArray(candidate.capabilities)
    || !candidate.capabilities.every((item) => typeof item === "string")
  ) {
    throw new Error("Invalid agent version");
  }
  return {
    protocolVersion: PROTOCOL_VERSION,
    serverVersion: candidate.serverVersion,
    piVersion: candidate.piVersion,
    piRevision: candidate.piRevision,
    capabilities: [...candidate.capabilities] as string[],
  };
}
