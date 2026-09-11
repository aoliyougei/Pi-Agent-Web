import { proxyAgentRequest, type AgentFetch } from "../proxy";

type Context = { params: Promise<{ id: string }> };
const ROOT = "/internal/v1/api/agent";

async function browserResponse(response: Response): Promise<Response> {
  if (response.ok || !response.headers.get("content-type")?.includes("application/json")) return response;
  const body = await response.json().catch(() => null);
  if (!body || typeof body !== "object") return Response.json({ error: "Invalid Agent response", code: "agent_bad_gateway" }, { status: 502 });
  if (body.error && typeof body.error === "object") {
    const { code, message, requestId } = body.error;
    return Response.json({ ...body, error: message, code, requestId }, { status: response.status, headers: response.headers });
  }
  return Response.json(body, { status: response.status, headers: response.headers });
}

/** Inactive until Phase 3: public Route Handlers continue using the baseline. */
export function createRemoteAgentRoutes(send: AgentFetch) {
  const session = async (request: Request, context: Context, suffix = "") => {
    const { id } = await context.params;
    if (!/^[A-Za-z0-9](?:[A-Za-z0-9._-]*[A-Za-z0-9])?$/.test(id) || id === "new" || id === "running") {
      return Response.json({ error: "Invalid session id", code: "invalid_request" }, { status: 400 });
    }
    const url = new URL(request.url);
    if (suffix === "/events") {
      const headers = new Headers(request.headers);
      if (!headers.has("last-event-id") && url.searchParams.has("cursor")) headers.set("last-event-id", url.searchParams.get("cursor")!);
      const response = await proxyAgentRequest(new Request(request, { headers }), `${ROOT}/${encodeURIComponent(id)}/events`, send);
      if (response.status === 409) {
        const body = await response.json().catch(() => null);
        if (body?.error?.code === "resync_required") {
          // EventSource cannot inspect a 409 body. Only this transport control is translated.
          return new Response('data: {"type":"resync_required"}\n\n', { headers: { "content-type": "text/event-stream", "cache-control": "no-cache, no-transform", "x-accel-buffering": "no" } });
        }
        return browserResponse(Response.json(body, { status: response.status, headers: response.headers }));
      }
      return browserResponse(response);
    }
    if (request.method === "GET" && !suffix) url.searchParams.set("start", "false");
    return browserResponse(await proxyAgentRequest(request, `${ROOT}/${encodeURIComponent(id)}${suffix}${url.search}`, send));
  };
  return {
    NEW: async (request: Request) => browserResponse(await proxyAgentRequest(request, `${ROOT}/new`, send)),
    RUNNING: async (request: Request) => browserResponse(await proxyAgentRequest(request, `${ROOT}/running`, send)),
    GET: (request: Request, context: Context) => session(request, context),
    POST: (request: Request, context: Context) => session(request, context),
    EVENTS: (request: Request, context: Context) => session(request, context, "/events"),
    BASH_OUTPUT: (request: Request, context: Context) => session(request, context, "/bash-output"),
  };
}
