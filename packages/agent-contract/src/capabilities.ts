export const REQUIRED_CAPABILITIES = [
  "extension-ui",
  "custom-ui",
  "remote-files",
  "subagents",
  "session-locks",
] as const;

export type AgentCapability = (typeof REQUIRED_CAPABILITIES)[number];
