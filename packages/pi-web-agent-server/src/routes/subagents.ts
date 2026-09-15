import type { IncomingMessage, ServerResponse } from "node:http";
import { abortSubagent, getSubagentRun, steerSubagent } from "../runtime/session-runtime.js";
import { readJson } from "./agent.js";

const ID = /^[A-Za-z0-9](?:[A-Za-z0-9._-]*[A-Za-z0-9])?$/;

function send(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(body));
}

function status(error: unknown): number {
  const direct = typeof error === "object" && error && "status" in error ? Number(error.status) : undefined;
  if (direct === 413 || direct === 415) return direct;
  const value = error instanceof Error ? error.message : String(error);
  return value.includes("not running") ? 409 : 500;
}

export async function routeSubagents(
  request: IncomingMessage,
  response: ServerResponse,
  path: string,
): Promise<boolean> {
  const match = /^\/internal\/v1\/api\/subagents\/([^/]+)$/.exec(path);
  if (!match || (request.method !== "GET" && request.method !== "POST")) return false;

  let id = "";
  try { id = decodeURIComponent(match[1]); } catch { /* invalid below */ }
  if (["profiles", "settings"].includes(id)) return false;
  if (!ID.test(id)) {
    send(response, 400, { error: "Invalid session id", code: "invalid_request" });
    return true;
  }

  if (request.method === "GET") {
    try {
      const run = await getSubagentRun(id);
      send(response, run ? 200 : 404, run ? { run } : { error: "Subagent not found" });
    } catch (error) {
      send(response, 500, { error: error instanceof Error ? error.message : String(error) });
    }
    return true;
  }

  try {
    const value = (await readJson(request)).value as { action?: unknown; message?: unknown };
    if (value.action === "steer") {
      if (typeof value.message !== "string" || !value.message.trim()) {
        send(response, 400, { error: "message required" });
        return true;
      }
      await steerSubagent(id, value.message);
    } else if (value.action === "abort") {
      await abortSubagent(id);
    } else {
      send(response, 400, { error: "action must be steer or abort" });
      return true;
    }
    send(response, 200, { ok: true, run: await getSubagentRun(id) });
  } catch (error) {
    send(response, status(error), { error: error instanceof Error ? error.message : String(error) });
  }
  return true;
}
