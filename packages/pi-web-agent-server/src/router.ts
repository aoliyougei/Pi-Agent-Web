import type { IncomingMessage, ServerResponse } from "node:http";
import { agentError, type AgentVersion } from "@aoliyougei/pi-agent-contract";
import { isAuthorized } from "./auth.js";
import { routeAgentRequest, type AgentRouteAdapter } from "./routes/agent.js";
import { AgentEventChannels, routeAgentEvents } from "./routes/events.js";
import { routeExtensionUi } from "./routes/extension-ui.js";
import { routeFiles } from "./routes/files.js";
import { routeGit } from "./routes/git.js";
import { routeSessions } from "./routes/sessions.js";
import { routeWorktrees } from "./routes/worktrees.js";
import { routeBashOutput } from "./routes/bash-output.js";
import { routeCustomUi } from "./routes/custom-ui.js";
import { RequestDeduplicator } from "./runtime/request-dedup.js";

function send(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(body));
}

export async function routeRequest(
  request: IncomingMessage,
  response: ServerResponse,
  options: {
    token: string;
    version: AgentVersion;
    ready: () => boolean;
    agent?: AgentRouteAdapter;
    dedup?: RequestDeduplicator;
    events?: AgentEventChannels;
  },
): Promise<void> {
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
  if (await routeFiles(request, response, path)) return;
  if (await routeGit(request, response, path)) return;
  if (await routeWorktrees(request, response, path)) return;
  if (await routeSessions(request, response, path)) return;
  if (await routeBashOutput(request, response, path)) return;
  const agent = options.agent;
  if (agent) {
    return routeCustomUi(request, response, path, requestId, agent)
      .then((handled) => handled || routeExtensionUi(request, response, path, requestId, agent))
      .then((uiHandled) => {
      if (uiHandled) return;
      const route = options.events
        ? routeAgentEvents(request, response, path, requestId, agent, options.events)
        : Promise.resolve(false);
      return route.then((handled) => handled
        ? undefined
        : routeAgentRequest(request, response, path, requestId, agent, options.dedup ?? new RequestDeduplicator()).then((agentHandled) => {
          if (!agentHandled) send(response, 404, agentError("invalid_request", "Not found", requestId));
        }));
    });
  }
  send(response, 404, agentError("invalid_request", "Not found", requestId));
}
