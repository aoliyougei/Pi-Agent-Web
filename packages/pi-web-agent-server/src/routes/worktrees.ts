import { existsSync } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import { join } from "node:path";
import { allowFileRoot } from "../dependencies/allowed-roots.js";
import { getAllowedFileRoots, isExistingFilePathAllowed, isFilePathAllowed } from "../dependencies/file-access.js";
import { projectIdentityKey } from "../dependencies/project-identity.js";
import { isExistingPathWithinRoots, isPathWithinRoots } from "../dependencies/path-security.js";
import { getAgentDir, listAllSessions } from "../dependencies/session-reader.js";
import { addWorktree, findCurrentWorktreePath, listWorktrees, removeWorktree, resolveProject, type WorktreeInfo } from "../dependencies/worktree.js";
import { readJson } from "./agent.js";
import { getRpcSessionOwnerships } from "../runtime/session-runtime.js";
import { acquireSessionLock } from "../runtime/session-lock.js";

function send(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(body));
}

async function allowed(cwd: string): Promise<boolean> {
  const roots = await getAllowedFileRoots();
  return isFilePathAllowed(cwd, roots) && isExistingFilePathAllowed(cwd, roots);
}

async function body(request: IncomingMessage): Promise<Record<string, unknown>> {
  const value = (await readJson(request)).value;
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid request body");
  return value as Record<string, unknown>;
}

async function list(request: IncomingMessage, response: ServerResponse): Promise<void> {
  const cwd = new URL(request.url!, "http://internal").searchParams.get("cwd");
  if (!cwd) { send(response, 400, { error: "cwd is required" }); return; }
  if (!await allowed(cwd)) { send(response, 403, { error: "Access denied" }); return; }
  const project = await resolveProject(cwd);
  let worktrees: WorktreeInfo[] = [], currentWorktreePath: string | null = null, isGit = true;
  try {
    worktrees = await listWorktrees(existsSync(cwd) ? cwd : project.projectRoot);
    currentWorktreePath = findCurrentWorktreePath(worktrees, cwd);
  } catch { isGit = false; }
  for (const worktree of worktrees) allowFileRoot(worktree.path);
  send(response, 200, { projectRoot: project.projectRoot, projectKey: projectIdentityKey(project.projectRoot), isGit, isTopLevel: project.isTopLevel, currentWorktreePath, worktrees });
}

async function add(request: IncomingMessage, response: ServerResponse): Promise<void> {
  const value = await body(request);
  if (typeof value.cwd !== "string" || !value.cwd) { send(response, 400, { error: "cwd is required" }); return; }
  if (typeof value.branch !== "string" || !value.branch) { send(response, 400, { error: "branch is required" }); return; }
  if (!await allowed(value.cwd)) { send(response, 403, { error: "Access denied" }); return; }
  if (!existsSync(value.cwd)) { send(response, 400, { error: `Directory does not exist: ${value.cwd}` }); return; }
  send(response, 200, await addWorktree(value.cwd, value.branch));
}

export function sessionFilesUnderWorktree(
  worktreePath: string,
  sessions: Array<{ cwd?: string; path?: string }>,
): string[] {
  const root = new Set([worktreePath]);
  const files = new Set<string>();
  for (const session of sessions) {
    if (typeof session.cwd !== "string" || (!isPathWithinRoots(session.cwd, root) && !isExistingPathWithinRoots(session.cwd, root))) continue;
    if (!session.path) throw Object.assign(new Error("Active Session has no lockable path"), { code: "session_locked" });
    files.add(session.path);
  }
  return [...files].sort();
}

async function remove(request: IncomingMessage, response: ServerResponse): Promise<void> {
  const value = await body(request);
  if (typeof value.cwd !== "string" || !value.cwd) { send(response, 400, { error: "cwd is required" }); return; }
  if (typeof value.path !== "string" || !value.path) { send(response, 400, { error: "path is required" }); return; }
  const cwd = value.cwd, worktreePath = value.path;
  if (!await allowed(cwd)) { send(response, 403, { error: "Access denied" }); return; }
  const lockDirectory = join(getAgentDir(), "locks", "sessions");
  const sessionFiles = sessionFilesUnderWorktree(worktreePath, [
    ...await listAllSessions({ force: true }),
    ...getRpcSessionOwnerships(),
  ]);
  const leases: Array<ReturnType<typeof acquireSessionLock>> = [];
  try {
    for (const file of sessionFiles) leases.push(acquireSessionLock(file, lockDirectory, "rpc-worktree-remove"));
    await removeWorktree(cwd, worktreePath, value.force === true);
  } finally {
    for (const lease of leases.reverse()) lease.release();
  }
  send(response, 200, { success: true });
}

export async function routeWorktrees(request: IncomingMessage, response: ServerResponse, path: string): Promise<boolean> {
  if (path !== "/internal/v1/api/worktrees" || !["GET", "POST", "DELETE"].includes(request.method ?? "")) return false;
  try {
    if (request.method === "GET") await list(request, response);
    else if (request.method === "POST") await add(request, response);
    else await remove(request, response);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (request.method === "GET") {
      send(response, 500, { error: String(error) });
    } else if (error && typeof error === "object" && "code" in error && error.code === "session_locked") {
      send(response, 409, { error: message, code: "session_locked" });
    } else if (request.method === "DELETE") {
      const dirty = /contains modified or untracked files|is dirty/i.test(message);
      send(response, dirty ? 409 : 400, { error: message, dirty });
    } else {
      send(response, 400, { error: message });
    }
  }
  return true;
}
