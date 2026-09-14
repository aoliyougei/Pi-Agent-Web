import { proxyJson, type AgentFetch } from "../proxy";
import { browserResponse } from "./agent";

const ROOT = "/internal/v1/api";
const query = (request: Request) => new URL(request.url).search;

export function createRemoteResourceRoutes(send: AgentFetch) {
  const fixed = async (request: Request, path: string) =>
    browserResponse(await proxyJson(request, `${ROOT}${path}${query(request)}`, send));
  const legacyJson = (request: Request, path: string) => {
    if (request.method === "GET" || request.method === "HEAD" || !request.body) return fixed(request, path);
    const headers = new Headers(request.headers);
    headers.set("content-type", "application/json");
    return fixed(new Request(request, { headers }), path);
  };
  return {
    SKILLS: (request: Request) => legacyJson(request, "/skills"),
    SKILL_INSTALL: (request: Request) => fixed(request, "/skills/install"),
    SKILL_SEARCH: (request: Request) => legacyJson(request, "/skills/search"),
    SKILL_CHECK: (request: Request) => legacyJson(request, "/skills/check"),
    SKILL_UPDATE: (request: Request) => legacyJson(request, "/skills/update"),
    PLUGINS: (request: Request) => fixed(request, "/plugins"),
    TOOLS_SETTINGS: (request: Request) => fixed(request, "/tools/settings"),
    PROJECT_TRUST: (request: Request) => legacyJson(request, "/project-trust"),
    SUBAGENT_SETTINGS: (request: Request) => fixed(request, "/subagents/settings"),
    SUBAGENT_PROFILES: (request: Request) => legacyJson(request, "/subagents/profiles"),
  };
}
