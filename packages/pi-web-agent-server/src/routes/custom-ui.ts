import type { IncomingMessage, ServerResponse } from "node:http";
import { agentError } from "@aoliyougei/pi-agent-contract";
import { readJson, type AgentRouteAdapter } from "./agent.js";

export async function routeCustomUi(request: IncomingMessage, response: ServerResponse, path: string, requestId: string, agent: AgentRouteAdapter): Promise<boolean> {
  const match = /^\/internal\/v1\/api\/agent\/([^/]+)\/custom-ui\/([^/]+)\/input$/.exec(path);
  if (!match || request.method !== "POST") return false;
  const send = (status: number, body: unknown) => {
    response.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
    response.end(JSON.stringify(body));
  };
  let sessionId: string;
  let customId: string;
  try {
    sessionId = decodeURIComponent(match[1]);
    customId = decodeURIComponent(match[2]);
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(sessionId) || !/^[A-Za-z0-9-]{1,128}$/.test(customId)) throw new Error();
  } catch {
    send(400, agentError("invalid_request", "Invalid custom UI path", requestId));
    return true;
  }
  let input: unknown;
  try {
    input = (await readJson(request)).value;
    if (!input || typeof input !== "object" || !("revision" in input) || !Number.isSafeInteger(input.revision)) throw new Error();
  } catch (error) {
    const status = error && typeof error === "object" && "status" in error ? Number(error.status) : 400;
    send(status, agentError(status === 413 ? "request_too_large" : "invalid_request", "Invalid custom UI input", requestId));
    return true;
  }
  const runtime = await agent.open(sessionId);
  if (!runtime || !("inputCustomUi" in runtime) || typeof runtime.inputCustomUi !== "function") {
    send(404, agentError("session_not_found", "Session not found", requestId));
    return true;
  }
  try {
    if (!runtime.inputCustomUi(customId, input)) send(409, agentError("request_settled", "Custom UI is not open", requestId));
    else send(200, { success: true });
  } catch {
    send(400, agentError("invalid_request", "Invalid custom UI input", requestId));
  }
  return true;
}
