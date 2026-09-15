import { proxyJson, type AgentFetch } from "../proxy";
import { browserResponse } from "./agent";

const ROOT = "/internal/v1/api/subagents";
const ID = /^[A-Za-z0-9](?:[A-Za-z0-9._-]*[A-Za-z0-9])?$/;
type Context = { params: Promise<{ id: string }> };

export function createRemoteSubagentRoutes(send: AgentFetch) {
  const route = async (request: Request, context: Context) => {
    const { id } = await context.params;
    if (!ID.test(id)) return Response.json({ error: "Invalid session id", code: "invalid_request" }, { status: 400 });
    let forwarded = request;
    if (request.body && request.method !== "GET" && request.method !== "HEAD") {
      const headers = new Headers(request.headers);
      headers.set("content-type", "application/json");
      forwarded = new Request(request, { headers });
    }
    return browserResponse(await proxyJson(
      forwarded,
      `${ROOT}/${encodeURIComponent(id)}${new URL(request.url).search}`,
      send,
    ));
  };
  return { GET: route, POST: route };
}
