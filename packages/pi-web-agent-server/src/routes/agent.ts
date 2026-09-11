import { createHash } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import {
  agentError,
  MAX_JSON_BYTES,
  parseAgentCommand,
  parseNewAgentRequest,
  type AgentCommand,
  type AgentErrorCode,
  type NewAgentRequest,
} from "@aoliyougei/pi-agent-contract";
import { RequestDeduplicator } from "../runtime/request-dedup.js";

export interface AgentRouteRuntime {
  send(command: AgentCommand): Promise<unknown>;
}

export interface AgentRouteAdapter {
  open(id: string): Promise<AgentRouteRuntime | null>;
  send(id: string, command: AgentCommand): Promise<{ found: boolean; data?: unknown }>;
  create(request: NewAgentRequest): Promise<{ id: string; runtime: AgentRouteRuntime }>;
  running(): {
    runningSessionIds: string[];
    completionNotificationSuppressedSessionIds: string[];
  };
}

const SESSION_ID = /^[A-Za-z0-9](?:[A-Za-z0-9._-]*[A-Za-z0-9])?$/;

function send(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
  });
  response.end(JSON.stringify(body));
}

async function readJson(request: IncomingMessage): Promise<{ value: unknown; bytes: Buffer }> {
  if (request.headers["content-type"]?.split(";", 1)[0].trim().toLowerCase() !== "application/json") {
    throw Object.assign(new Error("Content-Type must be application/json"), { status: 415 });
  }
  const declared = Number(request.headers["content-length"] ?? 0);
  if (Number.isFinite(declared) && declared > MAX_JSON_BYTES) throw Object.assign(new Error("Request too large"), { status: 413 });
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > MAX_JSON_BYTES) throw Object.assign(new Error("Request too large"), { status: 413 });
    chunks.push(buffer);
  }
  const bytes = Buffer.concat(chunks);
  try {
    return { value: JSON.parse(bytes.toString("utf8")), bytes };
  } catch {
    throw Object.assign(new Error("Invalid JSON"), { status: 400 });
  }
}

function invalid(error: unknown): Error & { status: number } {
  if (error instanceof Error && "status" in error) return error as Error & { status: number };
  return Object.assign(error instanceof Error ? error : new Error(String(error)), { status: 400 });
}

function fail(response: ServerResponse, error: unknown, requestId: string): void {
  const status = typeof error === "object" && error && "status" in error ? Number(error.status) : undefined;
  const code = typeof error === "object" && error && "code" in error ? String(error.code) : undefined;
  if (status === 400 || status === 413 || status === 415) {
    const errorCode: AgentErrorCode = status === 413 ? "request_too_large" : "invalid_request";
    send(response, status, agentError(errorCode, error instanceof Error ? error.message : "Invalid request", requestId));
    return;
  }
  if (code === "session_locked" || code === "request_id_conflict") {
    send(response, 409, agentError(code, error instanceof Error ? error.message : "Conflict", requestId));
    return;
  }
  send(response, 500, agentError("internal_error", "Internal error", requestId));
}

export async function routeAgentRequest(
  request: IncomingMessage,
  response: ServerResponse,
  path: string,
  requestId: string,
  agent: AgentRouteAdapter,
  dedup: RequestDeduplicator,
): Promise<boolean> {
  const prefix = "/internal/v1/api/agent/";
  if (!path.startsWith(prefix)) return false;
  const suffix = path.slice(prefix.length);

  if (request.method === "GET" && suffix === "running") {
    send(response, 200, agent.running());
    return true;
  }

  if (request.method === "POST" && suffix === "new") {
    let parsed: NewAgentRequest;
    let bytes: Buffer;
    try {
      const body = await readJson(request);
      parsed = parseNewAgentRequest(body.value);
      bytes = body.bytes;
    } catch (error) {
      fail(response, invalid(error), requestId);
      return true;
    }
    try {
      const operation = async () => {
        const created = await agent.create(parsed);
        const state = await created.runtime.send({ type: "get_state" }) as {
          model?: { id: string; provider: string };
          thinkingLevel?: string;
        };
        const data = parsed.command.type === "ensure_session" ? null : await created.runtime.send(parsed.command);
        return {
          success: true,
          sessionId: created.id,
          data,
          model: state.model ? { provider: state.model.provider, modelId: state.model.id } : null,
          thinkingLevel: state.thinkingLevel,
        };
      };
      const body = requestId === "unknown" ? await operation() : await dedup.run({
        id: requestId,
        fingerprint: createHash("sha256").update(request.method ?? "POST").update(path).update(bytes).digest("hex"),
      }, operation);
      send(response, 200, body);
    } catch (error) {
      fail(response, error, requestId);
    }
    return true;
  }

  let id: string;
  try {
    id = decodeURIComponent(suffix);
  } catch {
    send(response, 400, agentError("invalid_request", "Invalid session id", requestId));
    return true;
  }
  if (!SESSION_ID.test(id)) {
    send(response, 400, agentError("invalid_request", "Invalid session id", requestId));
    return true;
  }

  if (request.method !== "GET" && request.method !== "POST") return false;
  let command: AgentCommand;
  let bytes: Buffer | undefined;
  try {
    if (request.method === "POST") {
      const body = await readJson(request);
      command = parseAgentCommand(body.value);
      bytes = body.bytes;
    } else command = { type: "get_state" };
  } catch (error) {
    fail(response, invalid(error), requestId);
    return true;
  }
  try {
    if (request.method === "GET") {
      const runtime = await agent.open(id);
      if (!runtime) {
        send(response, 404, agentError("session_not_found", "Session not found", requestId));
        return true;
      }
      send(response, 200, { running: true, state: await runtime.send(command) });
      return true;
    }
    const operation = () => agent.send(id, command);
    const result = requestId === "unknown" ? await operation() : await dedup.run({
      id: requestId,
      fingerprint: createHash("sha256").update(request.method).update(path).update(bytes!).digest("hex"),
    }, operation);
    if (!result.found) {
      send(response, 404, agentError("session_not_found", "Session not found", requestId));
      return true;
    }
    send(response, 200, { success: true, data: result.data });
  } catch (error) {
    if (typeof error === "object" && error && "code" in error && error.code === "request_id_conflict") {
      fail(response, error, requestId);
    } else if (command.type === "prompt") {
      send(response, 500, {
        ...agentError("prompt_rejected", error instanceof Error ? error.message : String(error), requestId),
        accepted: false,
      });
    } else fail(response, error, requestId);
  }
  return true;
}
