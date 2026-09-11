import { createAgentClient } from "./client";
import { loadAgentRpcConfig } from "./config";

export async function agentFetch(path: string, init?: RequestInit) {
  return createAgentClient(await loadAgentRpcConfig()).fetch(path, init);
}

export { checkAgentCompatibility } from "./version-check";
