import type { IncomingMessage, ServerResponse } from "node:http";
import { agentError, type AgentVersion } from "@aoliyougei/pi-agent-contract";
import { isAuthorized } from "./auth.js";

function send(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(body));
}

export function routeRequest(
  request: IncomingMessage,
  response: ServerResponse,
  options: { token: string; version: AgentVersion; ready: () => boolean },
): void {
  const path = new URL(request.url ?? "/", "http://internal").pathname;
  if (request.method === "GET" && path === "/internal/v1/health/live") {
    send(response, 200, { status: "ok" });
    return;
  }
  const requestId = request.headers["x-request-id"]?.toString() ?? "unknown";
  if (!isAuthorized(request.headers.authorization, options.token)) {
    send(response, 401, agentError("unauthorized", "Unauthorized", requestId));
    return;
  }
  if (request.method === "GET" && path === "/internal/v1/health/ready") {
    if (options.ready()) send(response, 200, { status: "ok" });
    else send(response, 503, agentError("agent_unavailable", "Agent unavailable", requestId));
    return;
  }
  if (request.method === "GET" && path === "/internal/v1/version") {
    send(response, 200, options.version);
    return;
  }
  send(response, 404, agentError("invalid_request", "Not found", requestId));
}
