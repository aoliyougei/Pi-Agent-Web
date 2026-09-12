import type { IncomingMessage, ServerResponse } from "node:http";
import { existsSync, readdirSync, readFileSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { parseSavedSshEnvironment } from "../dependencies/middleware/ssh-remote-status/ssh-environment.js";
import { workspaceIdentityFromEnvironment } from "../dependencies/middleware/ssh-remote-status/workspace-model.js";
import { projectTreeForResponse } from "../dependencies/project-tree.js";
import { exportSessionHtml } from "../dependencies/session-export.js";
import {
  attachSessionProjectInfo,
  buildSessionContext,
  listAllSessions,
  mergeSessionLists,
  getAgentDir,
  getSessionEntries,
  invalidateSessionListCache,
  invalidateSessionPathCache,
  readSessionHeader,
  resolveSessionIdByPath,
  resolveSessionPath,
} from "../dependencies/session-reader.js";
import { computeSessionStats } from "../dependencies/session-stats.js";
import { computeSessionTotalActiveMs } from "../dependencies/session-timing.js";
import { generateSessionTitle } from "../dependencies/session-title.js";
import { readSessionToolSelection } from "../dependencies/session-tool-selection.js";
import { readSubagentRun, readSubagentSessionResources, SUBAGENT_META_TYPE } from "../dependencies/subagents.js";
import { sessionPathKey } from "../dependencies/session-path.js";
import { MAX_TOOL_RESULT_IMAGE_BYTES, TOOL_RESULT_IMAGE_MIMES } from "../dependencies/tool-result-images.js";
import type { SessionEntry, SessionInfo } from "../dependencies/types.js";
import { acquireSessionLock } from "../runtime/session-lock.js";
import {
  getCompletionNotificationSuppressedRpcSessionIds,
  getRpcSession,
  getRpcSessionInfos,
  getRunningRpcSessionIds,
  startRpcSession,
} from "../runtime/session-runtime.js";

const ROOT = "/internal/v1/api/sessions";
const SESSION_ID = /^[A-Za-z0-9](?:[A-Za-z0-9._-]*[A-Za-z0-9])?$/;

function send(response: ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}): void {
  response.writeHead(status, { "content-type": "application/json; charset=utf-8", ...headers });
  response.end(JSON.stringify(body));
}

function locked(response: ServerResponse, request: IncomingMessage, error: unknown): boolean {
  if (!error || typeof error !== "object" || !("code" in error) || error.code !== "session_locked") return false;
  send(response, 409, { error: { code: "session_locked", message: error instanceof Error ? error.message : "Session locked", requestId: request.headers["x-request-id"]?.toString() ?? "unknown" } });
  return true;
}

function sessionId(raw: string): string | null {
  try {
    const id = decodeURIComponent(raw);
    return SESSION_ID.test(id) ? id : null;
  } catch {
    return null;
  }
}

async function attachWorkspaceIdentities(sessions: SessionInfo[]): Promise<SessionInfo[]> {
  return Promise.all(sessions.map(async (session) => {
    try {
      const runtime = getRpcSession(session.id);
      const manager = runtime?.isAlive() ? runtime.inner.sessionManager : SessionManager.open(session.path);
      return { ...session, ...workspaceIdentityFromEnvironment(session, parseSavedSshEnvironment(manager.getBranch())) };
    } catch {
      return { ...session, ...workspaceIdentityFromEnvironment(session, { environment: null }) };
    }
  }));
}

async function list(request: IncomingMessage, response: ServerResponse): Promise<void> {
  const force = new URL(request.url!, "http://internal").searchParams.get("force") === "1";
  const [persisted, live] = await Promise.all([
    listAllSessions({ force }),
    attachSessionProjectInfo(getRpcSessionInfos()),
  ]);
  send(response, 200, {
    sessions: await attachWorkspaceIdentities(mergeSessionLists(persisted, live)),
    runningSessionIds: getRunningRpcSessionIds(),
    completionNotificationSuppressedSessionIds: getCompletionNotificationSuppressedRpcSessionIds(),
  }, { "cache-control": "no-store" });
}

async function openSession(id: string) {
  const runtime = getRpcSession(id);
  if (runtime?.isAlive()) return { runtime, manager: runtime.inner.sessionManager, resolvedPath: null };
  const resolvedPath = await resolveSessionPath(id);
  return resolvedPath ? { runtime: undefined, manager: SessionManager.open(resolvedPath), resolvedPath } : null;
}

async function detail(request: IncomingMessage, response: ServerResponse, id: string): Promise<void> {
  const opened = await openSession(id);
  if (!opened) { send(response, 404, { error: "Session not found" }); return; }
  const { runtime, manager, resolvedPath } = opened;
  const filePath = runtime?.sessionFile || manager.getSessionFile() || resolvedPath || "";
  const entries = manager.getEntries();
  const leafId = manager.getLeafId();
  const params = new URL(request.url!, "http://internal").searchParams;
  const rawTail = Number(params.get("tail"));
  const tail = Number.isFinite(rawTail) && rawTail > 0 ? Math.min(rawTail, 1000) : 50;
  const context = buildSessionContext(entries as never, leafId, {
    deferThinking: params.has("deferThinking"),
    deferToolResultImages: params.has("deferMedia"),
    tail,
    sessionId: id,
  });
  const stats = computeSessionStats(entries as unknown as SessionEntry[]);
  const header = manager.getHeader();
  let modified = header?.timestamp ?? new Date().toISOString();
  try { modified = statSync(filePath).mtime.toISOString(); } catch { /* transient Session */ }
  const parentSessionId = header?.parentSession ? await resolveSessionIdByPath(header.parentSession) : undefined;
  const subagent = header ? readSubagentRun(entries as never, header.id, filePath) : null;
  const toolNames = readSubagentSessionResources(entries as never)?.tools ?? readSessionToolSelection(entries as never);
  const firstUser = entries.find((entry) => entry.type === "message" && entry.message.role === "user");
  const firstUserMessage = firstUser?.type === "message" && firstUser.message.role === "user"
    ? firstUser.message
    : undefined;
  const info = header ? (await attachSessionProjectInfo([{
    path: filePath,
    id: header.id,
    cwd: header.cwd ?? "",
    name: manager.getSessionName(),
    created: header.timestamp,
    modified,
    messageCount: stats.totalMessages,
    firstMessage: firstUserMessage
      ? (() => {
          const content = firstUserMessage.content;
          return typeof content === "string"
            ? content
            : ((content.find((block) => block.type === "text") as { text?: string } | undefined)?.text ?? "") || "(no messages)";
        })()
      : "(no messages)",
    parentSessionId,
    ...(subagent
      ? { relation: { kind: "subagent" as const, parentSessionId: subagent.parentSessionId, profile: subagent.profile, description: subagent.description, status: runtime?.isRunning() ? "running" as const : subagent.status } }
      : header.parentSession
        ? { relation: { kind: "fork" as const, ...(parentSessionId ? { originSessionId: parentSessionId } : {}) } }
        : {}),
    transient: !filePath || !existsSync(filePath),
  }]))[0] : null;
  send(response, 200, {
    sessionId: id,
    filePath,
    info,
    leafId,
    tree: projectTreeForResponse(manager.getTree() as never),
    context,
    stats,
    totalActiveMs: computeSessionTotalActiveMs(entries),
    ...(toolNames !== undefined ? { toolNames } : {}),
  });
}

async function context(request: IncomingMessage, response: ServerResponse, id: string): Promise<void> {
  const opened = await openSession(id);
  if (!opened) { send(response, 404, { error: "Session not found" }); return; }
  const params = new URL(request.url!, "http://internal").searchParams;
  const leafId = params.get("leafId") ?? undefined;
  const before = params.get("before") ?? undefined;
  const rawTail = Number(params.get("tail"));
  const tail = Number.isFinite(rawTail) && rawTail > 0 ? Math.min(rawTail, 1000) : 50;
  send(response, 200, {
    context: buildSessionContext(opened.manager.getEntries() as never, before ?? leafId, {
      deferThinking: params.has("deferThinking"),
      deferToolResultImages: params.has("deferMedia"),
      tail,
      excludeLeaf: Boolean(before),
      sessionId: id,
    }),
    tail,
    before: before ?? null,
  });
}

async function readJson(request: IncomingMessage): Promise<unknown> {
  if (request.headers["content-type"]?.split(";", 1)[0].trim().toLowerCase() !== "application/json") throw new Error("Content-Type must be application/json");
  const chunks: Buffer[] = [];
  let bytes = 0;
  for await (const chunk of request) {
    const value = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    bytes += value.byteLength;
    if (bytes > 4096) throw new Error("Request body is too large");
    chunks.push(value);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString("utf8")); } catch { throw new Error("Invalid JSON"); }
}

async function rename(request: IncomingMessage, response: ServerResponse, id: string): Promise<void> {
  let body: unknown;
  try { body = await readJson(request); } catch (error) { send(response, 400, { error: error instanceof Error ? error.message : "Invalid request" }); return; }
  const name = body && typeof body === "object" && !Array.isArray(body) && "name" in body ? body.name : undefined;
  if (typeof name !== "string") { send(response, 400, { error: "name is required" }); return; }
  const runtime = getRpcSession(id);
  if (runtime?.isAlive()) {
    runtime.inner.setSessionName(name.trim());
    invalidateSessionListCache();
    send(response, 200, { ok: true });
    return;
  }
  const file = await resolveSessionPath(id);
  if (!file) { send(response, 404, { error: "Session not found" }); return; }
  const lease = acquireSessionLock(file, join(getAgentDir(), "locks", "sessions"), "rpc-session-rename");
  try { SessionManager.open(file).appendSessionInfo(name.trim()); }
  finally { lease.release(); }
  invalidateSessionListCache();
  send(response, 200, { ok: true });
}

async function remove(response: ServerResponse, id: string): Promise<void> {
  const file = await resolveSessionPath(id);
  if (!file) { send(response, 404, { error: "Session not found" }); return; }
  await getRpcSession(id)?.shutdown();
  const lockDirectory = join(getAgentDir(), "locks", "sessions");
  const leases = [acquireSessionLock(file, lockDirectory, "rpc-session-delete")];
  try {
    const parentPath = readSessionHeader(file)?.parentSession;
    const parentId = parentPath ? readSessionHeader(parentPath)?.id : undefined;
    const key = sessionPathKey(file);
    const children = readdirSync(dirname(file))
      .filter((name) => name.endsWith(".jsonl"))
      .map((name) => join(dirname(file), name))
      .filter((path) => sessionPathKey(path) !== key && sessionPathKey(readSessionHeader(path)?.parentSession ?? "") === key);
    for (const child of children.sort()) leases.push(acquireSessionLock(child, lockDirectory, "rpc-session-reparent"));
    for (const child of children) {
      try {
        const lines = readFileSync(child, "utf8").split("\n");
        const header = JSON.parse(lines[0]) as { parentSession?: string };
        header.parentSession = parentPath;
        lines[0] = JSON.stringify(header);
        if (parentPath && parentId) {
          for (let index = 1; index < lines.length; index++) {
            try {
              const entry = JSON.parse(lines[index]) as { type?: string; customType?: string; data?: unknown };
              if (entry.type !== "custom" || entry.customType !== SUBAGENT_META_TYPE || !entry.data || typeof entry.data !== "object" || Array.isArray(entry.data)) continue;
              entry.data = { ...entry.data, parentSessionId: parentId, parentSessionPath: parentPath };
              lines[index] = JSON.stringify(entry);
              break;
            } catch { /* malformed line */ }
          }
        }
        writeFileSync(child, lines.join("\n"));
      } catch { /* malformed or concurrently removed child */ }
    }
    unlinkSync(file);
  } finally {
    for (const lease of leases.reverse()) lease.release();
  }
  invalidateSessionPathCache(id);
  invalidateSessionListCache();
  send(response, 200, { ok: true });
}

function blockIndex(request: IncomingMessage): number | null {
  const value = new URL(request.url!, "http://internal").searchParams.get("blockIndex");
  const index = value === null ? Number.NaN : Number(value);
  return Number.isSafeInteger(index) && index >= 0 ? index : null;
}

function base64Image(block: unknown): { data: string; mime: string } | null {
  if (!block || typeof block !== "object" || Array.isArray(block) || !("type" in block) || block.type !== "image") return null;
  if ("data" in block && typeof block.data === "string" && "mimeType" in block && typeof block.mimeType === "string") return { data: block.data, mime: block.mimeType };
  if (!("source" in block) || !block.source || typeof block.source !== "object" || Array.isArray(block.source)) return null;
  return "type" in block.source && block.source.type === "base64" && "data" in block.source && typeof block.source.data === "string" && "media_type" in block.source && typeof block.source.media_type === "string"
    ? { data: block.source.data, mime: block.source.media_type }
    : null;
}

async function entryContent(request: IncomingMessage, response: ServerResponse, id: string, entryId: string, kind: string): Promise<void> {
  const index = blockIndex(request);
  if (index === null) { send(response, 400, { error: "Valid blockIndex is required" }); return; }
  const file = await resolveSessionPath(id);
  if (!file) { send(response, 404, { error: "Session not found" }); return; }
  const entry = getSessionEntries(file).find((candidate) => candidate.id === entryId);
  if (kind === "thinking") {
    if (!entry || entry.type !== "message" || entry.message.role !== "assistant") { send(response, 404, { error: "Assistant message not found" }); return; }
    const block = entry.message.content[index];
    if (!block || block.type !== "thinking") { send(response, 404, { error: "Thinking block not found" }); return; }
    send(response, 200, { thinking: block.thinking });
    return;
  }
  if (!entry || entry.type !== "message" || entry.message.role !== "toolResult") { send(response, 404, { error: "Tool result not found" }); return; }
  const image = base64Image(entry.message.content[index]);
  if (!image) { send(response, 404, { error: "Tool result image not found" }); return; }
  if (!TOOL_RESULT_IMAGE_MIMES.has(image.mime)) { send(response, 415, { error: "Unsupported image type" }); return; }
  if (image.data.length === 0 || image.data.length > Math.ceil(MAX_TOOL_RESULT_IMAGE_BYTES * 4 / 3) + 4 || image.data.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(image.data)) {
    send(response, 413, { error: "Invalid or oversized image data" }); return;
  }
  const bytes = Buffer.from(image.data, "base64");
  if (bytes.length === 0 || bytes.length > MAX_TOOL_RESULT_IMAGE_BYTES) { send(response, 413, { error: "Invalid or oversized image data" }); return; }
  response.writeHead(200, { "content-type": image.mime, "content-length": String(bytes.length), "cache-control": "private, no-cache", "x-content-type-options": "nosniff" });
  response.end(bytes);
}

async function autoName(response: ServerResponse, id: string): Promise<void> {
  const existing = getRpcSession(id);
  const file = existing?.isAlive() ? existing.sessionFile : await resolveSessionPath(id);
  if (!file) { send(response, 404, { error: "Session not found" }); return; }
  const runtime = existing?.isAlive() ? existing : (await startRpcSession(id, file, undefined)).session;
  await runtime.waitUntilReady?.();
  const generated = await generateSessionTitle(runtime.inner);
  if (!runtime.isAlive()) {
    send(response, 409, { error: "The session was closed while its title was being generated. Please try again." });
    return;
  }
  runtime.inner.setSessionName(generated.title);
  invalidateSessionListCache();
  send(response, 200, { title: generated.title, usage: generated.usage ?? null });
}

async function exportHtml(request: IncomingMessage, response: ServerResponse, id: string): Promise<void> {
  const file = await resolveSessionPath(id);
  if (!file) { send(response, 404, { error: "Session not found" }); return; }
  const exported = await exportSessionHtml(file, new URL(request.url!, "http://internal").searchParams.get("inline") === "1");
  response.writeHead(200, exported.headers);
  response.end(exported.html);
}

async function state(response: ServerResponse, id: string): Promise<void> {
  const runtime = getRpcSession(id);
  if (runtime?.isAlive()) {
    send(response, 200, { running: true, state: await runtime.send({ type: "get_state" }) });
    return;
  }
  if (!await resolveSessionPath(id)) { send(response, 404, { error: "Session not found" }); return; }
  send(response, 200, { running: false });
}

export async function routeSessions(request: IncomingMessage, response: ServerResponse, path: string): Promise<boolean> {
  if (request.method === "GET" && path === ROOT) {
    try { await list(request, response); } catch (error) { send(response, 500, { error: String(error) }, { "cache-control": "no-store" }); }
    return true;
  }
  const naming = /^\/internal\/v1\/api\/sessions\/([^/]+)\/auto-name$/.exec(path);
  if (request.method === "POST" && naming) {
    const id = sessionId(naming[1]);
    if (!id) { send(response, 400, { error: "Invalid session id" }); return true; }
    try { await autoName(response, id); }
    catch (error) { if (!locked(response, request, error)) send(response, 500, { error: String(error) }); }
    return true;
  }
  const entry = /^\/internal\/v1\/api\/sessions\/([^/]+)\/entries\/([^/]+)\/(thinking|tool-result-image)$/.exec(path);
  if (request.method === "GET" && entry) {
    const id = sessionId(entry[1]);
    const entryId = sessionId(entry[2]);
    if (!id || !entryId) { send(response, 400, { error: "Invalid id" }); return true; }
    try { await entryContent(request, response, id, entryId, entry[3]); }
    catch (error) { send(response, 500, { error: String(error) }); }
    return true;
  }
  const match = /^\/internal\/v1\/api\/sessions\/([^/]+)(\/context|\/state|\/export)?$/.exec(path);
  if (!match) return false;
  const id = sessionId(match[1]);
  if (!id) { send(response, 400, { error: "Invalid session id" }); return true; }
  try {
    if (request.method === "GET" && match[2] === "/context") await context(request, response, id);
    else if (request.method === "GET" && match[2] === "/state") await state(response, id);
    else if (request.method === "GET" && match[2] === "/export") await exportHtml(request, response, id);
    else if (request.method === "GET" && !match[2]) await detail(request, response, id);
    else if (request.method === "PATCH" && !match[2]) await rename(request, response, id);
    else if (request.method === "DELETE" && !match[2]) await remove(response, id);
    else return false;
  } catch (error) {
    if (!locked(response, request, error)) send(response, 500, { error: String(error) });
  }
  return true;
}
