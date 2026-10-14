import "server-only";
import { getBackend } from "./backends";
import { readDeploymentToken } from "./token";

export async function loadAgentRpcConfig(id = "default") {
  const backend = await getBackend(id);
  return { baseUrl: backend.baseUrl, token: backend.token ?? await readDeploymentToken() };
}
