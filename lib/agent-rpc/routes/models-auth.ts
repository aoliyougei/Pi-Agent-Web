import { proxyJson, type AgentFetch } from "../proxy";
import { browserResponse } from "./agent";

const ROOT = "/internal/v1/api";
const PROVIDER = /^[A-Za-z0-9](?:[A-Za-z0-9._-]*[A-Za-z0-9])?$/;
type ProviderContext = { params: Promise<{ provider: string }> };
const query = (request: Request) => new URL(request.url).search;

export function createRemoteModelsAuthRoutes(send: AgentFetch) {
  const fixed = async (request: Request, path: string) => browserResponse(await proxyJson(request, `${ROOT}${path}${query(request)}`, send));
  const provider = async (request: Request, context: ProviderContext, path: string) => {
    const value = (await context.params).provider;
    if (!PROVIDER.test(value)) return Response.json({ error: "Invalid provider", code: "invalid_request" }, { status: 400 });
    return fixed(request, `${path}/${encodeURIComponent(value)}`);
  };
  return {
    MODELS: (request: Request) => fixed(request, "/models"),
    MODELS_CONFIG: (request: Request) => fixed(request, "/models-config"),
    DISCOVER: (request: Request) => fixed(request, "/models-config/discover"),
    CATALOG: (request: Request) => fixed(request, "/models-config/catalog"),
    TEST: (request: Request) => fixed(request, "/models-config/test"),
    PROVIDERS: (request: Request) => fixed(request, "/auth/providers"),
    API_KEY: (request: Request, context: ProviderContext) => provider(request, context, "/auth/api-key"),
    LOGIN: (request: Request, context: ProviderContext) => provider(request, context, "/auth/login"),
    LOGOUT: (request: Request, context: ProviderContext) => provider(request, context, "/auth/logout"),
  };
}
