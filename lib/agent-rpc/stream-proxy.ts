import { proxyAgentRequest, type AgentFetch } from "./proxy";

export function proxyStream(
  request: Request,
  path: string,
  send: AgentFetch,
  allowedHeaders: readonly string[],
): Promise<Response> {
  return proxyAgentRequest(request, path, send, allowedHeaders);
}
