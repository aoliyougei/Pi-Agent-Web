import type { IncomingMessage, ServerResponse } from "node:http";
import { constants, mkdirSync, readdirSync, realpathSync, statSync, unlinkSync, watch, writeFileSync } from "node:fs";
import { lstat, open, type FileHandle } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { allowFileRoot } from "../dependencies/allowed-roots.js";
import { parseFormDataWithinLimit, RequestBodyTooLargeError } from "../dependencies/bounded-form-data.js";
import { defaultCwdPath } from "../dependencies/default-cwd.js";
import { getAllowedFileRoots, isExistingFilePathAllowed, isFilePathAllowed, isWindowsAbsolutePath, normalizeSlashes } from "../dependencies/file-access.js";
import { resolveDirentIsDirectory } from "../dependencies/file-dirent.js";
import { fileIndex as buildFileIndex } from "../dependencies/file-index.js";
import { DOCX_PREVIEW_MAX_BYTES, IMAGE_PREVIEW_MAX_BYTES, documentPreviewKind, getAudioMime, getDocumentMime, getFileExt, getImageMime, TEXT_PREVIEW_MAX_BYTES } from "../dependencies/file-types.js";
import { inspectUploadTargets, parseUploadConflictStrategy, validateUploadFileNames } from "../dependencies/file-upload.js";
import { isFilePathReferencedBySession } from "../dependencies/session-file-references.js";
import { samePath } from "../dependencies/paths.js";
import {
  getBrowseStartDirectory,
  getParentDirectory,
  listDirectories,
  listWindowsDrives,
  resolveDirectory,
  shouldShowWindowsDrivePicker,
} from "../dependencies/directory-browser.js";
import { projectIdentityKey } from "../dependencies/project-identity.js";
import { resolveProject } from "../dependencies/worktree.js";

function send(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(body));
}

async function json(request: IncomingMessage): Promise<unknown> {
  if (request.headers["content-type"]?.split(";", 1)[0].trim().toLowerCase() !== "application/json") throw new Error("Content-Type must be application/json");
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const value = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += value.length;
    if (size > 4096) throw new Error("Request body is too large");
    chunks.push(value);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

async function browse(request: IncomingMessage, response: ServerResponse): Promise<void> {
  const requested = new URL(request.url!, "http://internal").searchParams.get("path")?.trim();
  if (shouldShowWindowsDrivePicker(requested)) {
    send(response, 200, { path: "", parentPath: null, drives: await listWindowsDrives(), directories: [] });
    return;
  }
  let directory: string;
  try { directory = await resolveDirectory(getBrowseStartDirectory(requested)); }
  catch { send(response, 404, { error: "Directory does not exist" }); return; }
  if (!statSync(directory).isDirectory()) { send(response, 400, { error: "Path is not a directory" }); return; }
  send(response, 200, { path: directory, parentPath: getParentDirectory(directory), directories: await listDirectories(directory) });
}

async function validate(request: IncomingMessage, response: ServerResponse): Promise<void> {
  let body: unknown;
  try { body = await json(request); }
  catch (error) { send(response, 500, { error: String(error) }); return; }
  const cwd = body && typeof body === "object" && !Array.isArray(body) && "cwd" in body && typeof body.cwd === "string" ? body.cwd.trim() : "";
  if (!cwd) { send(response, 400, { error: "Path is required" }); return; }
  const normalized = cwd === "~" ? homedir() : cwd.startsWith("~/") ? resolve(homedir(), cwd.slice(2)) : isAbsolute(cwd) ? cwd : resolve(cwd);
  let stat;
  try { stat = statSync(normalized); }
  catch { send(response, 400, { error: `Directory does not exist: ${cwd}` }); return; }
  if (!stat.isDirectory()) { send(response, 400, { error: `Path is not a directory: ${cwd}` }); return; }
  allowFileRoot(normalized);
  const project = await resolveProject(normalized);
  send(response, 200, { success: true, cwd: normalized, projectRoot: project.projectRoot, projectKey: projectIdentityKey(project.projectRoot) });
}

function createDefaultCwd(response: ServerResponse): void {
  const cwd = defaultCwdPath(new Date(), process.env.PI_WEB_DEFAULT_CWD_ROOT);
  mkdirSync(cwd, { recursive: true });
  allowFileRoot(cwd);
  send(response, 200, { cwd });
}

const IGNORED_NAMES = new Set(["node_modules", ".git", ".next", "dist", "build", "__pycache__", ".turbo", ".cache", "coverage", ".pytest_cache", ".mypy_cache", "target", "vendor", ".DS_Store"]);
const IGNORED_SUFFIXES = [".pyc"];
const EXT_TO_LANGUAGE: Record<string, string> = {
  ts: "typescript", tsx: "typescript", js: "javascript", jsx: "javascript", mjs: "javascript", cjs: "javascript", py: "python", rb: "ruby",
  go: "go", rs: "rust", java: "java", kt: "kotlin", swift: "swift", c: "c", cpp: "cpp", h: "c", hpp: "cpp", cs: "csharp",
  html: "html", htm: "html", css: "css", scss: "css", less: "css", json: "json", jsonl: "json", yaml: "yaml", yml: "yaml",
  toml: "toml", xml: "xml", md: "markdown", mdx: "markdown", sh: "bash", bash: "bash", zsh: "bash", fish: "bash", sql: "sql",
  graphql: "graphql", gql: "graphql", dockerfile: "dockerfile", tf: "hcl", hcl: "hcl", env: "bash", gitignore: "bash", txt: "text",
};

function language(file: string): string {
  const base = basename(file).toLowerCase();
  if (base === "dockerfile" || base.startsWith("dockerfile.")) return "dockerfile";
  if (base === ".env" || base.startsWith(".env.")) return "bash";
  if (base === "makefile" || base === "gnumakefile") return "makefile";
  return EXT_TO_LANGUAGE[base.split(".").pop() ?? ""] ?? "text";
}

function filePathFromRoute(pathname: string): string | null {
  try {
    const segments = pathname.slice("/internal/v1/api/files/".length).split("/").filter(Boolean).map(decodeURIComponent);
    const joined = normalizeSlashes(segments.join("/"));
    return isWindowsAbsolutePath(joined) ? joined : "/" + joined.replace(/^\/+/, "");
  } catch {
    return null;
  }
}

function disposition(file: string, download: boolean): string {
  const name = basename(file);
  const fallback = name.replace(/[^\x20-\x7E]|["\\;\r\n]/g, "_") || "download";
  const encoded = encodeURIComponent(name).replace(/[!'()*]/g, (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`);
  return `${download ? "attachment" : "inline"}; filename="${fallback}"; filename*=UTF-8''${encoded}`;
}

async function openRegularFileNoFollow(file: string): Promise<{ handle: FileHandle; size: number }> {
  if (!(await lstat(file)).isFile()) throw new Error("Not a regular file");
  const handle = await open(file, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  try {
    const stat = await handle.stat();
    if (!stat.isFile()) throw new Error("Not a regular file");
    return { handle, size: stat.size };
  } catch (error) {
    await handle.close();
    throw error;
  }
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function previewHtml(body: string, name: string): string {
  return `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>
  :root { color-scheme: light; }
  html, body { margin: 0; min-height: 100%; background: #eef1f5; color: #171717; }
  body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; padding: 28px; }
  main {
    box-sizing: border-box;
    max-width: 840px;
    min-height: calc(100vh - 56px);
    margin: 0 auto;
    padding: 56px 64px;
    background: #fff;
    box-shadow: 0 8px 28px rgba(15, 23, 42, 0.14);
  }
  .file-title {
    margin: 0 0 28px;
    padding-bottom: 10px;
    border-bottom: 1px solid #e5e7eb;
    color: #6b7280;
    font: 12px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
    word-break: break-word;
  }
  h1, h2, h3, h4, h5, h6 { line-height: 1.3; margin: 1.1em 0 0.45em; color: #111827; }
  p { margin: 0.65em 0; line-height: 1.7; }
  table { border-collapse: collapse; max-width: 100%; margin: 1em 0; }
  th, td { border: 1px solid #d1d5db; padding: 6px 9px; vertical-align: top; }
  img { max-width: 100%; height: auto; }
  pre { white-space: pre-wrap; overflow-wrap: anywhere; }
  a { color: #2563eb; }
  @media (max-width: 720px) {
    body { padding: 0; background: #fff; }
    main { min-height: 100vh; padding: 28px 22px; box-shadow: none; }
  }
</style>
</head>
<body>
<main>
<div class="file-title">${escapeHtml(name)}</div>
${body}
</main>
</body>
</html>`;
}

async function streamFile(request: IncomingMessage, response: ServerResponse, handle: FileHandle, file: string, size: number, contentType: string, download: boolean): Promise<void> {
  const headers: Record<string, string> = {
    "content-type": contentType, "cache-control": "no-cache", "accept-ranges": "bytes",
    "content-disposition": disposition(file, download), "x-content-type-options": "nosniff",
  };
  if (contentType === "image/svg+xml") {
    headers["content-security-policy"] = "default-src 'none'; img-src data:; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'self'";
    headers["referrer-policy"] = "no-referrer";
  }
  const range = request.headers.range;
  let start = 0, end = size - 1, status = 200;
  if (range) {
    const match = /^bytes=(\d*)-(\d*)$/.exec(range);
    if (!match) { await handle.close(); response.writeHead(416, { ...headers, "content-range": `bytes */${size}` }); response.end(); return; }
    start = match[1] ? Number(match[1]) : 0;
    end = match[2] ? Number(match[2]) : size - 1;
    if (!match[1] && match[2]) { start = Math.max(size - Number(match[2]), 0); end = size - 1; }
    if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end < start || start >= size) {
      await handle.close(); response.writeHead(416, { ...headers, "content-range": `bytes */${size}` }); response.end(); return;
    }
    end = Math.min(end, size - 1);
    status = 206;
    headers["content-range"] = `bytes ${start}-${end}/${size}`;
  }
  headers["content-length"] = String(Math.max(0, end - start + 1));
  response.writeHead(status, headers);
  const stream = handle.createReadStream(status === 206 ? { start, end } : undefined);
  const cancel = () => stream.destroy();
  request.once("aborted", cancel);
  response.once("close", cancel);
  try { await pipeline(stream, response); }
  finally { request.off("aborted", cancel); response.off("close", cancel); }
}

function toRequest(request: IncomingMessage): Request {
  const headers = new Headers();
  for (const [name, value] of Object.entries(request.headers)) {
    if (typeof value === "string") headers.set(name, value);
    else if (value) for (const item of value) headers.append(name, item);
  }
  const init: RequestInit & { duplex: "half" } = {
    method: request.method,
    headers,
    body: Readable.toWeb(request) as ReadableStream<Uint8Array>,
    duplex: "half",
  };
  return new Request(new URL(request.url!, "http://internal"), init);
}

async function upload(request: IncomingMessage, response: ServerResponse, directory: string, type: string): Promise<void> {
  const roots = await getAllowedFileRoots();
  if (!isFilePathAllowed(directory, roots)) { send(response, 403, { error: "Access denied" }); return; }
  let stat;
  try { stat = statSync(directory); } catch { send(response, 404, { error: "Upload directory not found" }); return; }
  if (!stat.isDirectory()) { send(response, 400, { error: "Upload target is not a directory" }); return; }
  const realDirectory = realpathSync(directory);
  const realRoots = new Set<string>();
  for (const root of roots) try { realRoots.add(realpathSync(root)); } catch { /* stale root */ }
  if (!isFilePathAllowed(realDirectory, realRoots)) { send(response, 403, { error: "Access denied" }); return; }
  if (type === "upload-check") {
    let body: unknown;
    try { body = await json(request); } catch (error) { send(response, 500, { error: String(error) }); return; }
    const names = body && typeof body === "object" && !Array.isArray(body) && "fileNames" in body && Array.isArray(body.fileNames) && body.fileNames.every((name) => typeof name === "string") ? body.fileNames : null;
    if (!names) { send(response, 400, { error: "fileNames must be an array of strings" }); return; }
    const invalid = validateUploadFileNames(names);
    if (invalid) { send(response, 400, { error: invalid }); return; }
    send(response, 200, inspectUploadTargets(realDirectory, names));
    return;
  }
  if (type !== "upload") { send(response, 400, { error: "Invalid upload request type" }); return; }
  const strategy = parseUploadConflictStrategy(new URL(request.url!, "http://internal").searchParams.get("conflict"));
  if (!strategy) { send(response, 400, { error: "Invalid conflict strategy" }); return; }
  let form: FormData;
  try { form = await parseFormDataWithinLimit(toRequest(request), 101 * 1024 * 1024); }
  catch (error) {
    if (error instanceof RequestBodyTooLargeError) { send(response, 413, { error: "Uploads must total 100MB or less" }); return; }
    throw error;
  }
  const files = form.getAll("files").filter((entry): entry is File => typeof entry !== "string");
  if (files.some((file) => file.size > 25 * 1024 * 1024)) { send(response, 413, { error: "Each upload must be 25MB or smaller" }); return; }
  if (files.reduce((total, file) => total + file.size, 0) > 100 * 1024 * 1024) { send(response, 413, { error: "Uploads must total 100MB or less" }); return; }
  const names = files.map((file) => file.name);
  const invalid = validateUploadFileNames(names);
  if (invalid) { send(response, 400, { error: invalid }); return; }
  const inspection = inspectUploadTargets(realDirectory, names);
  if (strategy === "error" && inspection.conflicts.length) { send(response, 409, { error: "One or more files already exist", ...inspection }); return; }
  const conflicts = new Set(inspection.conflicts), blocked = new Set(inspection.nonReplaceable);
  const uploaded: string[] = [], skipped: string[] = [], errors: Array<{ name: string; error: string }> = [];
  for (const file of files) {
    const destination = join(realDirectory, file.name);
    if (conflicts.has(file.name) && strategy === "skip") { skipped.push(file.name); continue; }
    if (conflicts.has(file.name) && blocked.has(file.name)) { errors.push({ name: file.name, error: "Cannot replace a directory or symbolic link" }); continue; }
    let bytes: Buffer;
    try { bytes = Buffer.from(await file.arrayBuffer()); }
    catch (error) { errors.push({ name: file.name, error: error instanceof Error ? error.message : String(error) }); continue; }
    if (conflicts.has(file.name)) try { unlinkSync(destination); } catch (error) { errors.push({ name: file.name, error: error instanceof Error ? error.message : String(error) }); continue; }
    try { writeFileSync(destination, bytes, { flag: "wx" }); uploaded.push(file.name); }
    catch (error) { errors.push({ name: file.name, error: error instanceof Error ? error.message : String(error) }); }
  }
  send(response, errors.length ? 207 : 200, { uploaded, skipped, errors });
}

async function indexFiles(request: IncomingMessage, response: ServerResponse): Promise<void> {
  const url = new URL(request.url!, "http://internal");
  const cwd = url.searchParams.get("cwd")?.trim() ?? "";
  if (!cwd || (!cwd.startsWith("/") && !isWindowsAbsolutePath(cwd))) { send(response, 400, { error: "cwd must be an absolute path" }); return; }
  const roots = await getAllowedFileRoots();
  if (!isFilePathAllowed(cwd, roots)) { send(response, 403, { error: "Access denied" }); return; }
  let stat;
  try { stat = statSync(cwd); } catch { send(response, 404, { error: "Directory not found" }); return; }
  if (!stat.isDirectory()) { send(response, 400, { error: "Not a directory" }); return; }
  if (!isExistingFilePathAllowed(cwd, roots)) { send(response, 403, { error: "Access denied" }); return; }
  send(response, 200, await buildFileIndex(cwd, url.searchParams.get("q")?.slice(0, 500) ?? ""));
}

async function files(request: IncomingMessage, response: ServerResponse, pathname: string): Promise<void> {
  const file = filePathFromRoute(pathname);
  if (!file) { send(response, 400, { error: "Invalid file path" }); return; }
  const url = new URL(request.url!, "http://internal");
  const type = url.searchParams.get("type") ?? "list";
  if (request.method === "POST") { await upload(request, response, file, type); return; }
  if (!["list", "read", "download", "meta", "preview", "watch"].includes(type)) { send(response, 400, { error: "Invalid file request type" }); return; }
  const roots = await getAllowedFileRoots();
  const rootAllowed = isFilePathAllowed(file, roots);
  const referenceAllowed = !rootAllowed && type !== "list" && await isFilePathReferencedBySession(file, url.searchParams.get("sessionId"));
  if (!rootAllowed && !referenceAllowed) { send(response, 403, { error: "Access denied" }); return; }
  let stat;
  try { stat = statSync(file); } catch { if (type !== "watch") { send(response, 404, { error: "Not found" }); return; } }
  if (!referenceAllowed && !isExistingFilePathAllowed(stat ? file : dirname(file), roots)) { send(response, 403, { error: "Access denied" }); return; }
  if (type === "list") {
    if (!stat?.isDirectory()) { send(response, 400, { error: "Not a directory" }); return; }
    const entries = readdirSync(file, { withFileTypes: true })
      .filter((entry) => !IGNORED_NAMES.has(entry.name) && !IGNORED_SUFFIXES.some((suffix) => entry.name.endsWith(suffix)))
      .flatMap((entry) => {
        const isDir = resolveDirentIsDirectory(entry, join(file, entry.name));
        return isDir === null ? [] : [{ name: entry.name, isDir, size: 0, modified: "" }];
      })
      .sort((a, b) => a.isDir === b.isDir ? a.name.localeCompare(b.name) : a.isDir ? -1 : 1);
    send(response, 200, { entries, path: file });
    return;
  }
  if (type === "watch") {
    if (stat && !stat.isFile()) { send(response, 400, { error: "Not a file" }); return; }
    let lastMtimeMs = stat?.mtimeMs ?? 0, lastCtimeMs = stat?.ctimeMs ?? 0, lastIno = stat?.ino ?? 0, lastSize = stat?.size ?? 0;
    let exists = !!stat;
    response.writeHead(200, {
      "content-type": "text/event-stream", "cache-control": "no-cache, no-transform", connection: "keep-alive", "x-accel-buffering": "no",
    });
    const sendEvent = (event: string, data: unknown) => response.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    const watcher = watch(dirname(file), (_event, changed) => {
      if (changed != null && !samePath(join(dirname(file), changed.toString()), file)) return;
      try {
        const next = statSync(file);
        if (exists && next.mtimeMs === lastMtimeMs && next.ctimeMs === lastCtimeMs && next.ino === lastIno && next.size === lastSize) return;
        exists = true; lastMtimeMs = next.mtimeMs; lastCtimeMs = next.ctimeMs; lastIno = next.ino; lastSize = next.size;
        sendEvent("change", { mtime: next.mtime.toISOString(), size: next.size });
      } catch {
        if (!exists) return;
        exists = false;
        sendEvent("change", { mtime: new Date().toISOString(), size: 0 });
      }
    });
    const close = () => watcher.close();
    watcher.once("error", () => { watcher.close(); response.end(); });
    request.once("aborted", close);
    response.once("close", close);
    sendEvent("connected", { filePath: file });
    return;
  }
  if (!stat?.isFile()) { send(response, 400, { error: "Not a file" }); return; }
  const imageMime = getImageMime(file), audioMime = getAudioMime(file), documentMime = getDocumentMime(file);
  if (type === "read" && imageMime && stat.size > IMAGE_PREVIEW_MAX_BYTES) { send(response, 413, { error: "Image too large (>10MB)" }); return; }
  if (type === "meta") {
    send(response, 200, { size: stat.size, language: language(file), mime: imageMime || audioMime || documentMime || "text/plain", previewKind: documentPreviewKind(file) });
    return;
  }
  let opened;
  try { opened = await openRegularFileNoFollow(file); }
  catch { send(response, 404, { error: "Not found" }); return; }
  const { handle, size } = opened;
  if (type === "preview") {
    if (getFileExt(file) !== "docx") { await handle.close(); send(response, 400, { error: "Preview not available for this file type" }); return; }
    if (size > DOCX_PREVIEW_MAX_BYTES) { await handle.close(); send(response, 413, { error: "DOCX too large for preview (>10MB)" }); return; }
    const bytes = await handle.readFile();
    await handle.close();
    const mammoth = await import("mammoth");
    const result = await mammoth.convertToHtml({ buffer: bytes }, { externalFileAccess: false, convertImage: mammoth.images.dataUri });
    response.writeHead(200, {
      "content-type": "text/html; charset=utf-8", "cache-control": "no-cache",
      "content-security-policy": "default-src 'none'; img-src data:; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'self'",
      "referrer-policy": "no-referrer", "x-content-type-options": "nosniff",
    });
    response.end(previewHtml(result.value, basename(file)));
    return;
  }
  const mime = imageMime || audioMime || documentMime;
  if (type === "read" && !mime) {
    if (size > TEXT_PREVIEW_MAX_BYTES) { await handle.close(); send(response, 413, { error: "File too large for preview (>256KB)" }); return; }
    const content = await handle.readFile({ encoding: "utf8" });
    await handle.close();
    send(response, 200, { content, language: language(file), size });
    return;
  }
  await streamFile(request, response, handle, file, size, mime || "application/octet-stream", type === "download");
}

export async function routeFiles(request: IncomingMessage, response: ServerResponse, path: string): Promise<boolean> {
  try {
    if ((request.method === "GET" || request.method === "POST") && path.startsWith("/internal/v1/api/files/")) await files(request, response, path);
    else if (request.method === "GET" && path === "/internal/v1/api/file-index") await indexFiles(request, response);
    else if (request.method === "GET" && path === "/internal/v1/api/cwd/browse") await browse(request, response);
    else if (request.method === "POST" && path === "/internal/v1/api/cwd/validate") await validate(request, response);
    else if (request.method === "POST" && path === "/internal/v1/api/default-cwd") createDefaultCwd(response);
    else return false;
  } catch (error) {
    send(response, 500, { error: String(error) });
  }
  return true;
}
