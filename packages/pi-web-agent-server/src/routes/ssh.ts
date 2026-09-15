import type { IncomingMessage, ServerResponse } from "node:http";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { parseSavedSshEnvironment } from "../dependencies/middleware/ssh-remote-status/ssh-environment.js";
import { resolveRemotePath } from "../dependencies/middleware/ssh-remote-status/remote-path-security.js";
import {
  executeRemoteTool,
  parseRemoteListResult,
  parseRemoteReadResult,
} from "../dependencies/middleware/ssh-remote-status/remote-tool-bridge.js";
import { resolveSessionPath } from "../dependencies/session-reader.js";
import { getRpcSession } from "../runtime/session-runtime.js";

const ID = /^[A-Za-z0-9](?:[A-Za-z0-9._-]*[A-Za-z0-9])?$/;

function send(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(body));
}

function sessionId(raw: string): string | null {
  try {
    const id = decodeURIComponent(raw);
    return ID.test(id) ? id : null;
  } catch {
    return null;
  }
}

function requestSignal(request: IncomingMessage, response: ServerResponse): AbortSignal {
  const abort = new AbortController();
  if (request.aborted) abort.abort();
  request.once("aborted", () => abort.abort());
  response.once("close", () => { if (!response.writableEnded) abort.abort(); });
  return abort.signal;
}

async function environment(response: ServerResponse, id: string): Promise<void> {
  try {
    const runtime = getRpcSession(id);
    const path = runtime?.isAlive() ? null : await resolveSessionPath(id);
    if (!runtime?.isAlive() && !path) { send(response, 404, { error: "Session not found" }); return; }
    const manager = runtime?.isAlive() ? runtime.inner.sessionManager : SessionManager.open(path!);
    send(response, 200, { ...parseSavedSshEnvironment(manager.getBranch()), source: "saved-session" });
  } catch {
    send(response, 500, { error: "Unable to read SSH environment" });
  }
}

async function remote(
  request: IncomingMessage,
  response: ServerResponse,
  id: string,
  operation: "remote-files" | "remote-file",
): Promise<void> {
  try {
    const runtime = getRpcSession(id);
    if (!runtime?.isAlive()) { send(response, 409, { error: "Remote session is not running" }); return; }
    const saved = parseSavedSshEnvironment(runtime.inner.sessionManager.getBranch());
    if (!saved.environment) { send(response, 409, { error: "Saved SSH environment is unavailable" }); return; }
    const input = new URL(request.url!, "http://internal").searchParams.get("path");
    if (operation === "remote-file" && !input) { send(response, 400, { error: "Path is required" }); return; }
    const path = resolveRemotePath({
      platform: saved.environment.remotePlatform,
      root: saved.environment.remoteCwd,
      input: input ?? ".",
    });
    const name = operation === "remote-files" ? "ls" : "read";
    const result = await executeRemoteTool(
      runtime.inner,
      name,
      name === "ls" ? { path, limit: 500 } : { path },
      runtime.inner.sessionManager.getCwd(),
      requestSignal(request, response),
    );
    send(response, 200, name === "ls"
      ? { path, entries: parseRemoteListResult(result) }
      : { path, file: parseRemoteReadResult(result) });
  } catch (error) {
    send(response, 400, { error: error instanceof Error ? error.message : operation === "remote-files" ? "Unable to list remote directory" : "Unable to read remote file" });
  }
}

export async function routeSsh(
  request: IncomingMessage,
  response: ServerResponse,
  path: string,
): Promise<boolean> {
  if (request.method !== "GET") return false;
  const environmentMatch = /^\/internal\/v1\/api\/sessions\/([^/]+)\/ssh-environment$/.exec(path);
  const remoteMatch = /^\/internal\/v1\/api\/agent\/([^/]+)\/(remote-files|remote-file)$/.exec(path);
  const match = environmentMatch ?? remoteMatch;
  if (!match) return false;
  const id = sessionId(match[1]);
  if (!id) { send(response, 400, { error: "Invalid session id", code: "invalid_request" }); return true; }
  if (environmentMatch) await environment(response, id);
  else await remote(request, response, id, remoteMatch![2] as "remote-files" | "remote-file");
  return true;
}
