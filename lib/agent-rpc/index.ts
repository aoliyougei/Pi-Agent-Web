import { cookies } from "next/headers";
import { BACKEND_COOKIE } from "../agent-backend-selection";
import { createAgentClient } from "./client";
import { loadAgentRpcConfig } from "./config";

export async function agentFetch(path: string, init?: RequestInit) {
  const id = (await cookies()).get(BACKEND_COOKIE)?.value ?? "default";
  return createAgentClient(await loadAgentRpcConfig(id)).fetch(path, init);
}

export { checkAgentCompatibility } from "./version-check";
