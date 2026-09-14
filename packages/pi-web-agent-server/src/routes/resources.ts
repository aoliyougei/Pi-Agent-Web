import { existsSync, readFileSync, statSync, writeFileSync } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { getAllowedFileRoots, isExistingFilePathAllowed } from "../dependencies/file-access.js";
import { invalidateModelsCache } from "../dependencies/models-cache.js";
import { runNpx, type RunNpxOptions, type RunNpxResult } from "../dependencies/npx.js";
import { mutatePlugins, readPlugins, type PluginAction } from "../dependencies/plugins.js";
import { readPowerShellToolEnabled, writePowerShellToolEnabled } from "../dependencies/powershell-settings.js";
import { getProjectTrustStatus, trustProject } from "../dependencies/project-trust.js";
import { setDisableModelInvocation } from "../dependencies/skill-frontmatter.js";
import { buildSkillUpdateArgs, checkSkillUpdates } from "../dependencies/skill-updates.js";
import { loadSkillsWithInstallInfo } from "../dependencies/skills-service.js";
import { readSubagentSettings, writeBuiltInSubagentsEnabled } from "../dependencies/subagent-settings.js";
import {
  deleteSubagentProfile,
  listSubagentProfileSources,
  saveSubagentProfile,
  type SubagentProfile,
  type SubagentWritableScope,
} from "../dependencies/subagents.js";
import { destroyRpcSessionsForCwd, hasBusyRpcSessionForCwd } from "../runtime/session-runtime.js";
import { readJson } from "./agent.js";

export interface ResourceAdapter {
  runNpx(args: string[], options: RunNpxOptions): Promise<RunNpxResult>;
  fetch(input: string, init?: RequestInit): Promise<Response>;
  mutatePlugins?: typeof mutatePlugins;
}
const defaultAdapter: ResourceAdapter = { runNpx, fetch, mutatePlugins };
const MAX_UPSTREAM_BYTES = 2 * 1024 * 1024;
let mutationTail = Promise.resolve();
function serialized<T>(operation: () => Promise<T>): Promise<T> {
  const result = mutationTail.then(operation, operation);
  mutationTail = result.then(() => undefined, () => undefined);
  return result;
}

function send(response: ServerResponse, status: number, value: unknown): void {
  response.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(value));
}
function requestSignal(request: IncomingMessage, response: ServerResponse, timeoutMs: number): AbortSignal {
  const abort = new AbortController();
  if (request.aborted) abort.abort();
  request.once("aborted", () => abort.abort());
  response.once("close", () => { if (!response.writableEnded) abort.abort(); });
  return AbortSignal.any([abort.signal, AbortSignal.timeout(timeoutMs)]);
}
function redactPrivatePaths(value: string): string {
  return value.split(getAgentDir()).join("<agent-dir>");
}
async function boundedJson(response: Response): Promise<unknown> {
  const declared = Number(response.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > MAX_UPSTREAM_BYTES) {
    await response.body?.cancel();
    throw new Error("Upstream response is too large");
  }
  if (!response.body) throw new Error("Upstream response was not valid JSON");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_UPSTREAM_BYTES) {
      await reader.cancel();
      throw new Error("Upstream response is too large");
    }
    chunks.push(value);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}
function record(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value); }
async function body(request: IncomingMessage): Promise<Record<string, unknown>> {
  try {
    return (await readJson(request)).value as Record<string, unknown>;
  } catch (error) {
    if (record(error) && error.status === 400) throw new Error(error instanceof Error ? error.message : "Invalid JSON");
    throw error;
  }
}
function httpError(message: string, status: number): Error {
  return Object.assign(new Error(message), { status });
}
async function allowedCwd(
  value: unknown,
  missingMessage = "Valid cwd required",
  notDirectoryMessage = missingMessage,
): Promise<string> {
  if (typeof value !== "string" || !value.trim()) throw httpError(missingMessage, 400);
  const cwd = resolve(value);
  if (!existsSync(cwd)) throw httpError(missingMessage, 400);
  if (!statSync(cwd).isDirectory()) throw httpError(notDirectoryMessage, 400);
  if (!isExistingFilePathAllowed(cwd, await getAllowedFileRoots())) throw httpError("Access denied", 403);
  return cwd;
}
function errorStatus(error: unknown, fallback: number): number {
  const status = record(error) && typeof error.status === "number" ? error.status : undefined;
  return status === 400 || status === 403 || status === 413 || status === 415 ? status : fallback;
}

async function tools(request: IncomingMessage, response: ServerResponse): Promise<void> {
  try {
    if (request.method === "GET") {
      send(response, 200, { isWindows: process.platform === "win32", powerShellEnabled: await readPowerShellToolEnabled() });
      return;
    }
    if (process.platform !== "win32") { send(response, 404, { error: "PowerShell tool settings are only available on Windows" }); return; }
    const value = await body(request);
    if (typeof value.enabled !== "boolean") { send(response, 400, { error: "enabled must be a boolean" }); return; }
    send(response, 200, { isWindows: true, powerShellEnabled: await writePowerShellToolEnabled(value.enabled) });
  } catch (error) { send(response, errorStatus(error, 500), { error: error instanceof Error ? error.message : String(error) }); }
}

async function settings(request: IncomingMessage, response: ServerResponse): Promise<void> {
  try {
    if (request.method === "GET") { send(response, 200, { enabled: readSubagentSettings().builtInEnabled }); return; }
    const value = await body(request);
    if (typeof value.enabled !== "boolean") { send(response, 400, { error: "enabled must be a boolean" }); return; }
    send(response, 200, { enabled: writeBuiltInSubagentsEnabled(value.enabled).builtInEnabled });
  } catch (error) { send(response, errorStatus(error, 500), { error: error instanceof Error ? error.message : String(error) }); }
}

function scope(value: unknown): SubagentWritableScope {
  if (value !== "global" && value !== "project") throw new Error("scope must be global or project");
  return value;
}
async function skills(request: IncomingMessage, response: ServerResponse): Promise<void> {
  try {
    if (request.method === "GET") {
      const cwd = await allowedCwd(new URL(request.url!, "http://internal").searchParams.get("cwd"), "cwd required");
      send(response, 200, await loadSkillsWithInstallInfo(cwd));
      return;
    }
    const value = await body(request);
    if (typeof value.filePath !== "string" || !value.filePath) { send(response, 400, { error: "filePath required" }); return; }
    if (typeof value.disableModelInvocation !== "boolean") { send(response, 400, { error: "disableModelInvocation must be a boolean" }); return; }
    if (!existsSync(value.filePath)) { send(response, 404, { error: "file not found" }); return; }
    const roots = new Set(await getAllowedFileRoots());
    roots.add(getAgentDir());
    const globalSkillsDir = join(homedir(), ".agents", "skills");
    if (existsSync(globalSkillsDir)) roots.add(globalSkillsDir);
    if (!isExistingFilePathAllowed(value.filePath, roots)) { send(response, 403, { error: "Access denied" }); return; }
    writeFileSync(value.filePath, setDisableModelInvocation(readFileSync(value.filePath, "utf8"), value.disableModelInvocation), "utf8");
    send(response, 200, { success: true });
  } catch (error) { send(response, errorStatus(error, 500), { error: error instanceof Error ? error.message : String(error) }); }
}

const PLUGIN_ACTIONS = new Set<PluginAction>(["install", "remove", "update", "disable", "enable"]);
async function plugins(request: IncomingMessage, response: ServerResponse, adapter: ResourceAdapter): Promise<void> {
  try {
    if (request.method === "GET") {
      const cwd = await allowedCwd(new URL(request.url!, "http://internal").searchParams.get("cwd"), "cwd required");
      send(response, 200, await readPlugins(cwd));
      return;
    }
    const value = await body(request);
    const cwd = await allowedCwd(value.cwd, "cwd required");
    if (typeof value.action !== "string" || !value.action) { send(response, 400, { error: "action required" }); return; }
    if (value.scope === "project" && !getProjectTrustStatus(cwd, getAgentDir()).trusted) {
      send(response, 403, { error: "Project resources must be trusted before modifying project plugins" });
      return;
    }
    if (!PLUGIN_ACTIONS.has(value.action as PluginAction)) { send(response, 400, { error: `Unsupported action: ${value.action}` }); return; }
    if (value.action !== "update" && (typeof value.source !== "string" || !value.source.trim())) { send(response, 400, { error: "source required" }); return; }
    send(response, 200, await serialized(() => (adapter.mutatePlugins ?? mutatePlugins)({
      action: value.action as PluginAction,
      source: typeof value.source === "string" ? value.source : undefined,
      scope: value.scope === "project" ? "project" : "global",
      cwd,
    })));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const status = message === "Project resources must be trusted before modifying project plugins" ? 403 : errorStatus(error, 500);
    send(response, status, { error: redactPrivatePaths(message) });
  }
}

const ANSI_RE = /\x1B\[[0-9;]*m/g;
function parseLimit(value: unknown): number {
  const number = typeof value === "number" ? value : Number(value);
  return Number.isFinite(number) ? Math.min(50, Math.max(1, Math.floor(number))) : 50;
}
function installs(count: unknown): string {
  if (typeof count !== "number" || count <= 0) return "";
  if (count >= 1_000_000) return `${(count / 1_000_000).toFixed(1).replace(/\.0$/, "")}M installs`;
  if (count >= 1_000) return `${(count / 1_000).toFixed(1).replace(/\.0$/, "")}K installs`;
  return `${count} install${count === 1 ? "" : "s"}`;
}
function parseSearchOutput(raw: string): Array<{ package: string; installs: string; url: string }> {
  const lines = raw.replace(ANSI_RE, "").split("\n");
  return lines.flatMap((value, index) => {
    const match = value.trim().match(/^([\w.\-]+\/[\w.\-@:]+)\s+([\d.,]+[KMB]?\s+installs)$/);
    if (!match) return [];
    const url = lines[index + 1]?.trim().replace(/^└\s*/, "");
    return [{ package: match[1], installs: match[2], url: url?.startsWith("https://") ? url : "" }];
  });
}
function installCount(value: string): number {
  const match = value.match(/^([\d.]+)([KMB])?\s+installs?$/);
  if (!match) return 0;
  return Number(match[1]) * (match[2] === "B" ? 1e9 : match[2] === "M" ? 1e6 : match[2] === "K" ? 1e3 : 1);
}
async function skillInstall(request: IncomingMessage, response: ServerResponse, adapter: ResourceAdapter): Promise<void> {
  try {
    const value = await body(request);
    const pkg = typeof value.package === "string" ? value.package.trim() : "";
    if (!pkg) { send(response, 400, { error: "package required" }); return; }
    const project = value.scope === "project";
    let cwd: string | undefined;
    if (project) {
      cwd = await allowedCwd(value.cwd, "cwd required for project install");
      if (!getProjectTrustStatus(cwd, getAgentDir()).trusted) { send(response, 403, { error: "Project resources must be trusted before installing project skills" }); return; }
    }
    const args = ["skills", "add", pkg, "-y", "--agent", "pi", ...(project ? [] : ["-g"])];
    const result = await serialized(() => adapter.runNpx(args, {
      timeout: 60_000,
      cwd,
      env: { ...process.env, FORCE_COLOR: "0" },
      signal: requestSignal(request, response, 60_000),
    }));
    const output = `${result.stdout}${result.stderr}`.replace(ANSI_RE, "");
    if (!/Installation complete|Installed \d+ skill/.test(output)) { send(response, 500, { error: output.slice(-300) || "Install failed" }); return; }
    send(response, 200, { success: true, output });
  } catch (error) {
    const detail = error as { stdout?: string; stderr?: string; message?: string };
    const output = `${detail.stdout ?? ""}${detail.stderr ?? ""}`.replace(ANSI_RE, "");
    send(response, errorStatus(error, 500), { error: redactPrivatePaths(output || detail.message || String(error)) });
  }
}
async function skillSearch(request: IncomingMessage, response: ServerResponse, adapter: ResourceAdapter): Promise<void> {
  try {
    const value = await body(request);
    const query = typeof value.query === "string" ? value.query.trim() : "";
    if (!query) { send(response, 400, { error: "query required" }); return; }
    const limit = parseLimit(value.limit);
    const base = process.env.SKILLS_API_URL || "https://skills.sh";
    try {
      const upstream = await adapter.fetch(`${base}/api/search?q=${encodeURIComponent(query)}&limit=${limit}`, {
        cache: "no-store",
        signal: requestSignal(request, response, 20_000),
      });
      if (!upstream.ok) throw new Error(`skills.sh search failed: HTTP ${upstream.status}`);
      const data = await boundedJson(upstream);
      if (!record(data) || !Array.isArray(data.skills)) throw new Error("Malformed skills search response");
      const rows = data.skills;
      const results = rows.flatMap((raw) => {
        if (!record(raw) || typeof raw.name !== "string" || (!raw.source && !raw.id)) return [];
        const source = typeof raw.source === "string" ? raw.source.trim() : "";
        const id = typeof raw.id === "string" ? raw.id.trim() : "";
        const name = raw.name.trim();
        if (!name || (!source && !id)) return [];
        return [{ package: `${source || id}@${name}`, installs: installs(raw.installs), url: id ? `${base}/${id}` : "" }];
      }).sort((left, right) => installCount(right.installs) - installCount(left.installs)).slice(0, limit);
      send(response, 200, { results });
    } catch {
      const result = await adapter.runNpx(["skills", "find", query], {
        timeout: 20_000,
        env: { ...process.env, FORCE_COLOR: "0" },
        signal: requestSignal(request, response, 20_000),
      });
      send(response, 200, { results: parseSearchOutput(`${result.stdout}${result.stderr}`).slice(0, limit) });
    }
  } catch (error) {
    const detail = error as { stdout?: string; stderr?: string; message?: string };
    const parsed = parseSearchOutput(`${detail.stdout ?? ""}${detail.stderr ?? ""}`);
    send(response, parsed.length ? 200 : 500, parsed.length
      ? { results: parsed }
      : { error: redactPrivatePaths(detail.message || String(error)) });
  }
}

async function skillCheck(request: IncomingMessage, response: ServerResponse, adapter: ResourceAdapter): Promise<void> {
  try {
    const value = await body(request);
    const cwd = await allowedCwd(value.cwd, "cwd required");
    const pkg = typeof value.package === "string" ? value.package : undefined;
    const scope = value.scope === "global" || value.scope === "project" ? value.scope : undefined;
    if ((pkg && !scope) || (!pkg && scope)) { send(response, 400, { error: "package and scope must be provided together" }); return; }
    const loaded = await loadSkillsWithInstallInfo(cwd);
    const candidates = loaded.skills.flatMap((skill) => skill.install ? [skill.install] : [])
      .filter((install) => !pkg || (install.package === pkg && install.scope === scope));
    if (pkg && candidates.length === 0) { send(response, 404, { error: "Installed skill not found" }); return; }
    const signal = requestSignal(request, response, 15_000);
    send(response, 200, { updates: await checkSkillUpdates(candidates, {
      fetcher: async (input, init) => {
        const upstream = await adapter.fetch(input, {
          ...init,
          signal: init?.signal ? AbortSignal.any([init.signal, signal]) : signal,
        });
        if (!upstream.ok) return upstream;
        return Response.json(await boundedJson(upstream), { status: upstream.status });
      },
      githubToken: process.env.GITHUB_TOKEN || process.env.GH_TOKEN,
    }) });
  } catch (error) { send(response, errorStatus(error, 500), { error: redactPrivatePaths(error instanceof Error ? error.message : String(error)) }); }
}
async function skillUpdate(request: IncomingMessage, response: ServerResponse, adapter: ResourceAdapter): Promise<void> {
  try {
    const value = await body(request);
    const cwd = await allowedCwd(value.cwd, "cwd, package, and scope are required");
    const pkg = typeof value.package === "string" ? value.package : "";
    const scope = value.scope === "global" || value.scope === "project" ? value.scope : undefined;
    if (!pkg || !scope) { send(response, 400, { error: "cwd, package, and scope are required" }); return; }
    if (scope === "project" && !getProjectTrustStatus(cwd, getAgentDir()).trusted) {
      send(response, 403, { error: "Project resources must be trusted before updating project skills" });
      return;
    }
    const loaded = await loadSkillsWithInstallInfo(cwd);
    const install = loaded.skills.find((skill) => skill.install?.package === pkg && skill.install.scope === scope)?.install;
    if (!install) { send(response, 404, { error: "Installed skill not found" }); return; }
    if (!install.canCheckForUpdates) { send(response, 400, { error: "This skill cannot be updated automatically" }); return; }
    const result = await serialized(() => adapter.runNpx(buildSkillUpdateArgs(install), {
      timeout: 60_000,
      cwd: scope === "project" ? cwd : undefined,
      env: { ...process.env, FORCE_COLOR: "0" },
      signal: requestSignal(request, response, 60_000),
    }));
    const refreshed = await loadSkillsWithInstallInfo(cwd);
    send(response, 200, {
      success: true,
      skill: refreshed.skills.find((skill) => skill.install?.package === pkg && skill.install.scope === scope),
      output: `${result.stdout}${result.stderr}`.slice(-500),
    });
  } catch (error) {
    const detail = error as { stdout?: string; stderr?: string; message?: string };
    send(response, errorStatus(error, 500), { error: redactPrivatePaths(`${detail.stdout ?? ""}${detail.stderr ?? ""}` || detail.message || String(error)) });
  }
}

async function profiles(request: IncomingMessage, response: ServerResponse): Promise<void> {
  try {
    const value = request.method === "GET"
      ? { cwd: new URL(request.url!, "http://internal").searchParams.get("cwd") }
      : await body(request);
    const cwd = await allowedCwd(value.cwd);
    if (request.method === "GET") { send(response, 200, { profiles: listSubagentProfileSources(cwd) }); return; }
    const targetScope = scope(value.scope);
    if (request.method === "PUT") {
      if (!record(value.profile) || typeof value.profile.name !== "string") { send(response, 400, { error: "profile required" }); return; }
      send(response, 200, { profile: saveSubagentProfile(cwd, targetScope, value.profile as unknown as Omit<SubagentProfile, "scope" | "filePath">) });
      return;
    }
    if (typeof value.name !== "string") { send(response, 400, { error: "name required" }); return; }
    const name = value.name;
    if (request.method === "DELETE") {
      deleteSubagentProfile(cwd, targetScope, name);
      send(response, 200, { ok: true });
      return;
    }
    if (typeof value.enabled !== "boolean") { send(response, 400, { error: "enabled required" }); return; }
    const current = listSubagentProfileSources(cwd).find((entry) => entry.scope === targetScope && entry.name.toLowerCase() === name.toLowerCase());
    if (!current) { send(response, 404, { error: "Agent profile not found" }); return; }
    send(response, 200, { profile: saveSubagentProfile(cwd, targetScope, { ...current, enabled: value.enabled }) });
  } catch (error) { send(response, errorStatus(error, 400), { error: error instanceof Error ? error.message : String(error) }); }
}

async function projectTrust(request: IncomingMessage, response: ServerResponse): Promise<void> {
  try {
    const raw = request.method === "GET"
      ? new URL(request.url!, "http://internal").searchParams.get("cwd")
      : (await body(request)).cwd;
    const cwd = await allowedCwd(
      raw,
      typeof raw === "string" && raw.trim() ? "Directory does not exist" : "cwd required",
      "cwd must be a directory",
    );
    if (request.method === "GET") { send(response, 200, getProjectTrustStatus(cwd, getAgentDir())); return; }
    const current = getProjectTrustStatus(cwd, getAgentDir());
    if (!current.requiresTrust) { send(response, 409, { error: "This project has no resources that require trust" }); return; }
    if (hasBusyRpcSessionForCwd(cwd)) { send(response, 409, { error: "Wait for the active session to finish before trusting this project" }); return; }
    const status = trustProject(cwd, getAgentDir());
    invalidateModelsCache();
    await destroyRpcSessionsForCwd(cwd);
    send(response, 200, status);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    send(response, errorStatus(error, 500), { error: message });
  }
}

export async function routeResources(request: IncomingMessage, response: ServerResponse, path: string, adapter: ResourceAdapter = defaultAdapter): Promise<boolean> {
  if (path === "/internal/v1/api/skills/install" && request.method === "POST") { await skillInstall(request, response, adapter); return true; }
  if (path === "/internal/v1/api/skills/search" && request.method === "POST") { await skillSearch(request, response, adapter); return true; }
  if (path === "/internal/v1/api/skills/check" && request.method === "POST") { await skillCheck(request, response, adapter); return true; }
  if (path === "/internal/v1/api/skills/update" && request.method === "POST") { await skillUpdate(request, response, adapter); return true; }
  if (path === "/internal/v1/api/skills" && (request.method === "GET" || request.method === "PATCH")) { await skills(request, response); return true; }
  if (path === "/internal/v1/api/plugins" && (request.method === "GET" || request.method === "POST")) { await plugins(request, response, adapter); return true; }
  if (path === "/internal/v1/api/tools/settings" && (request.method === "GET" || request.method === "PUT")) { await tools(request, response); return true; }
  if (path === "/internal/v1/api/subagents/settings" && (request.method === "GET" || request.method === "PUT")) { await settings(request, response); return true; }
  if (path === "/internal/v1/api/subagents/profiles" && ["GET", "PUT", "PATCH", "DELETE"].includes(request.method ?? "")) { await profiles(request, response); return true; }
  if (path === "/internal/v1/api/project-trust" && (request.method === "GET" || request.method === "POST")) { await projectTrust(request, response); return true; }
  return false;
}
