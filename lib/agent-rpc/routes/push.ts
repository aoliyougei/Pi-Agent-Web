import { proxyJson, type AgentFetch } from "../proxy";
import { browserResponse } from "./agent";

const ROOT = "/internal/v1/api/push";

export function createRemotePushRoutes(send: AgentFetch) {
  return {
    CONFIG: async (request: Request) => browserResponse(await proxyJson(request, `${ROOT}/config`, send)),
    SUBSCRIBE: async (request: Request) => browserResponse(await proxyJson(request, `${ROOT}/subscribe`, send)),
  };
}
