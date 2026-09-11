import { proxyAgentRequest, type AgentFetch } from "../proxy";

type Context = { params: Promise<{ id: string }> };
const ROOT = "/internal/v1/api/agent";

/** Inactive until Phase 3: public Route Handlers continue using the baseline. */
export function createRemoteAgentRoutes(send: AgentFetch) {
  const session = async (request: Request, context: Context, suffix = "") => {
    const { id } = await context.params;
    if (!/^[A-Za-z0-9](?:[A-Za-z0-9._-]*[A-Za-z0-9])?$/.test(id) || id === "new" || id === "running") {
      return Response.json({ error: "Invalid session id", code: "invalid_request" }, { status: 400 });
    }
    return proxyAgentRequest(request, `${ROOT}/${encodeURIComponent(id)}${suffix}${new URL(request.url).search}`, send);
  };
  return {
    NEW: (request: Request) => proxyAgentRequest(request, `${ROOT}/new`, send),
    RUNNING: (request: Request) => proxyAgentRequest(request, `${ROOT}/running`, send),
    GET: (request: Request, context: Context) => session(request, context),
    POST: (request: Request, context: Context) => session(request, context),
    EVENTS: (request: Request, context: Context) => session(request, context, "/events"),
    BASH_OUTPUT: (request: Request, context: Context) => session(request, context, "/bash-output"),
  };
}
