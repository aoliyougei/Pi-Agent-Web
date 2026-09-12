import { statSync } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import { getAllowedFileRoots, isExistingFilePathAllowed, isFilePathAllowed, isWindowsAbsolutePath } from "../dependencies/file-access.js";
import { getGitFileDiff, getGitStatus } from "../dependencies/git-changes.js";

function send(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(body));
}

function absolute(value: string): boolean {
  return value.startsWith("/") || isWindowsAbsolutePath(value);
}

export async function routeGit(request: IncomingMessage, response: ServerResponse, path: string): Promise<boolean> {
  if (request.method !== "GET" || (path !== "/internal/v1/api/git/status" && path !== "/internal/v1/api/git/diff")) return false;
  try {
    const url = new URL(request.url!, "http://internal");
    const cwd = url.searchParams.get("cwd")?.trim() ?? "";
    if (!cwd || !absolute(cwd)) { send(response, 400, { error: "cwd must be an absolute path" }); return true; }
    const roots = await getAllowedFileRoots();
    if (!isFilePathAllowed(cwd, roots)) { send(response, 403, { error: "Access denied" }); return true; }
    if (path.endsWith("/diff")) {
      const file = url.searchParams.get("path")?.trim() ?? "";
      if (!file || !absolute(file)) { send(response, 400, { error: "path must be an absolute path" }); return true; }
      if (!isFilePathAllowed(file, roots)) { send(response, 403, { error: "Access denied" }); return true; }
      if (!isExistingFilePathAllowed(cwd, roots)) { send(response, 403, { error: "Access denied" }); return true; }
      send(response, 200, await getGitFileDiff(cwd, file));
      return true;
    }
    let stat;
    try { stat = statSync(cwd); } catch { send(response, 404, { error: "Directory not found" }); return true; }
    if (!stat.isDirectory()) { send(response, 400, { error: "Not a directory" }); return true; }
    if (!isExistingFilePathAllowed(cwd, roots)) { send(response, 403, { error: "Access denied" }); return true; }
    send(response, 200, await getGitStatus(cwd));
  } catch (error) {
    send(response, 500, { error: error instanceof Error ? error.message : String(error) });
  }
  return true;
}
