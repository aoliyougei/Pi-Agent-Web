import { proxyJson, type AgentFetch } from "../proxy";
import { browserResponse } from "./agent";

type Context = { params: Promise<{ id: string }> };
const ID = /^[A-Za-z0-9](?:[A-Za-z0-9._-]*[A-Za-z0-9])?$/;
const query = (request: Request) => new URL(request.url).search;

export function createRemoteSshRoutes(send: AgentFetch) {
  const route = async (request: Request, context: Context, path: (id: string) => string) => {
    const { id } = await context.params;
    if (!ID.test(id)) return Response.json({ error: "Invalid session id", code: "invalid_request" }, { status: 400 });
    return browserResponse(await proxyJson(request, `${path(encodeURIComponent(id))}${query(request)}`, send));
  };
  return {
    ENVIRONMENT: (request: Request, context: Context) => route(request, context, (id) => `/internal/v1/api/sessions/${id}/ssh-environment`),
    FILES: (request: Request, context: Context) => route(request, context, (id) => `/internal/v1/api/agent/${id}/remote-files`),
    FILE: (request: Request, context: Context) => route(request, context, (id) => `/internal/v1/api/agent/${id}/remote-file`),
  };
}
