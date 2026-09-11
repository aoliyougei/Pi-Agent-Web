import type { IncomingMessage, ServerResponse } from "node:http";
import { agentError, type OrdinaryExtensionUiRequest } from "@aoliyougei/pi-agent-contract";
import type { AgentRouteAdapter, AgentRouteRuntime } from "./agent.js";

const SESSION_ID = /^[A-Za-z0-9](?:[A-Za-z0-9._-]*[A-Za-z0-9])?$/;
const REQUEST_ID = /^[A-Za-z0-9-]{1,128}$/;

type UiRuntime = AgentRouteRuntime & {
  getPendingExtensionUiRequests(): OrdinaryExtensionUiRequest[];
  respondToExtensionUi(id: string, response: unknown): boolean;
};

function send(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
  response.end(JSON.stringify(body));
}

async function json(request: IncomingMessage): Promise<unknown> {
  if (request.headers["content-type"]?.split(";", 1)[0].trim().toLowerCase() !== "application/json") throw new Error("Content-Type must be application/json");
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > 4096) throw new Error("Response body is too large");
    chunks.push(buffer);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString("utf8")); } catch { throw new Error("Invalid JSON"); }
}

export async function routeExtensionUi(
  request: IncomingMessage,
  response: ServerResponse,
  path: string,
  requestId: string,
  agent: AgentRouteAdapter,
): Promise<boolean> {
  const pending = /^\/internal\/v1\/api\/agent\/([^/]+)\/extension-ui\/pending$/.exec(path);
  const responding = /^\/internal\/v1\/api\/agent\/([^/]+)\/extension-ui\/([^/]+)\/response$/.exec(path);
  if (!pending && !responding) return false;
  let sessionId: string;
  try { sessionId = decodeURIComponent((pending ?? responding)![1]); } catch { sessionId = ""; }
  if (!SESSION_ID.test(sessionId)) {
    send(response, 400, agentError("invalid_request", "Invalid session id", requestId));
    return true;
  }
  const runtime = await agent.open(sessionId) as UiRuntime | null;
  if (!runtime || typeof runtime.getPendingExtensionUiRequests !== "function" || typeof runtime.respondToExtensionUi !== "function") {
    send(response, 404, agentError("session_not_found", "Session not found", requestId));
    return true;
  }

  if (pending && request.method === "GET") {
    send(response, 200, { requests: runtime.getPendingExtensionUiRequests() });
    return true;
  }
  if (responding && request.method === "POST") {
    let uiRequestId: string;
    try { uiRequestId = decodeURIComponent(responding[2]); } catch { uiRequestId = ""; }
    if (!REQUEST_ID.test(uiRequestId)) {
      send(response, 400, agentError("invalid_request", "Invalid UI request id", requestId));
      return true;
    }
    let value: unknown;
    try { value = await json(request); } catch (error) {
      send(response, 400, agentError("invalid_request", error instanceof Error ? error.message : "Invalid response", requestId));
      return true;
    }
    const exists = runtime.getPendingExtensionUiRequests().some((item) => item.id === uiRequestId);
    if (!exists) {
      send(response, 404, agentError("invalid_request", "UI request not found", requestId));
      return true;
    }
    if (!runtime.respondToExtensionUi(uiRequestId, value)) {
      send(response, 400, agentError("invalid_request", "Invalid UI response", requestId));
      return true;
    }
    send(response, 200, { success: true });
    return true;
  }
  return false;
}
