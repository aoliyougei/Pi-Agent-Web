import { mkdtempSync, rmSync, statSync, writeFileSync } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { completeSimple, getSupportedThinkingLevels, type AssistantMessage } from "@earendil-works/pi-ai/compat";
import { createAgentSessionServices, getAgentDir, ModelRuntime, type SettingsManager } from "@earendil-works/pi-coding-agent";
import { getAllowedFileRoots, isExistingFilePathAllowed } from "../dependencies/file-access.js";
import { flattenModelsDevCatalog, recommendModelCatalogPreset, searchModelCatalog, type ModelCatalogEntry } from "../dependencies/model-catalog.js";
import { resolveModelDiscoveryAuth } from "../dependencies/model-discovery-auth.js";
import { buildModelsListUrl, parseDiscoveredModels } from "../dependencies/model-discovery.js";
import { MASKED_API_KEY, maskModelsConfig, readModelsConfig, writeModelsConfig } from "../dependencies/models-config-store.js";
import { loadModelsWithCache, withModelRuntimeError, withSafeModelLoadFailure, type ModelsData } from "../dependencies/models-cache.js";
import { resolveVisibleModels, selectInitialModelScope } from "../dependencies/model-scope.js";
import { projectTrustReloadOptions } from "../dependencies/project-trust.js";
import { readJson } from "./agent.js";

const MODELS_DEV_URL = "https://models.dev/api.json";
const MAX_UPSTREAM_BYTES = 2 * 1024 * 1024;
const modelNameCollator = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });
const EMPTY_MODELS: ModelsData = { models: {}, modelList: [], defaultModel: null, thinkingLevels: {}, thinkingLevelMaps: {}, thinkingLevelPins: {} };

interface CatalogCache { entries: ModelCatalogEntry[]; expiresAt: number; inFlight?: Promise<ModelCatalogEntry[]> }
declare global { var __piModelsDevCatalogCache: CatalogCache | undefined }

function send(response: ServerResponse, status: number, value: unknown): void {
  response.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(value));
}
function record(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value); }
async function body(request: IncomingMessage): Promise<Record<string, unknown>> {
  const value = (await readJson(request)).value;
  if (!record(value)) throw new Error("Invalid request body");
  return value;
}
function effectiveApi(value: unknown): string { return typeof value === "string" && value ? value : "openai-completions"; }
function providerWithStoredKey(name: string, provider: Record<string, unknown>): Record<string, unknown> {
  if (provider.apiKey !== MASKED_API_KEY) return provider;
  const configured = readModelsConfig().providers;
  const current = record(configured) ? configured[name] : undefined;
  if (!record(current) || current.baseUrl !== provider.baseUrl || effectiveApi(current.api) !== effectiveApi(provider.api) || typeof current.apiKey !== "string") {
    return { ...provider, apiKey: undefined };
  }
  return { ...provider, apiKey: current.apiKey };
}

async function loadModels(cwd: string): Promise<ModelsData> {
  const agentDir = getAgentDir();
  const trust = projectTrustReloadOptions(cwd, agentDir);
  const services = await createAgentSessionServices({ cwd, agentDir, ...(trust ? { resourceLoaderReloadOptions: trust } : {}) });
  const scope = await resolveVisibleModels(services.modelRuntime, services.settingsManager.getEnabledModels());
  const models = scope.visible.map((model) => ({ id: model.id, name: model.name, provider: model.provider }))
    .sort((a, b) => modelNameCollator.compare(a.name || a.id, b.name || b.id) || modelNameCollator.compare(a.provider, b.provider) || modelNameCollator.compare(a.id, b.id));
  const names: Record<string, string> = {}, levels: Record<string, string[]> = {}, maps: Record<string, Record<string, string | null>> = {};
  for (const model of scope.visible) {
    const key = `${model.provider}:${model.id}`;
    names[key] = model.name;
    levels[key] = getSupportedThinkingLevels(model);
    if (model.thinkingLevelMap) maps[key] = model.thinkingLevelMap;
  }
  const settings: SettingsManager = services.settingsManager;
  const provider = settings.getDefaultProvider(), modelId = settings.getDefaultModel();
  const initial = selectInitialModelScope(scope, provider && modelId ? { defaultModel: { provider, modelId } } : {});
  return withModelRuntimeError({
    models: names,
    modelList: models,
    defaultModel: initial.model ? { provider: initial.model.provider, modelId: initial.model.id } : null,
    thinkingLevels: levels,
    thinkingLevelMaps: maps,
    thinkingLevelPins: scope.thinkingLevelPins,
    ...(scope.warnings.length ? { modelScopeWarnings: scope.warnings } : {}),
  }, services.modelRuntime.getError());
}

async function models(request: IncomingMessage, response: ServerResponse): Promise<void> {
  const requested = new URL(request.url!, "http://internal").searchParams.get("cwd") || process.cwd();
  const cwd = resolve(requested);
  let stat;
  try { stat = statSync(cwd); } catch { send(response, 400, { error: `Directory does not exist: ${cwd}` }); return; }
  if (!stat.isDirectory()) { send(response, 400, { error: `Not a directory: ${cwd}` }); return; }
  if (!isExistingFilePathAllowed(cwd, await getAllowedFileRoots())) { send(response, 403, { error: "Access denied" }); return; }
  try { send(response, 200, await loadModelsWithCache(cwd, () => loadModels(cwd))); }
  catch { send(response, 200, withSafeModelLoadFailure(EMPTY_MODELS)); }
}

async function config(request: IncomingMessage, response: ServerResponse): Promise<void> {
  if (request.method === "GET") { send(response, 200, maskModelsConfig(readModelsConfig())); return; }
  try { writeModelsConfig(await body(request)); send(response, 200, { success: true }); }
  catch (error) { send(response, 500, { error: String(error) }); }
}

function requestSignal(request: IncomingMessage, response: ServerResponse, timeoutMs: number): AbortSignal {
  const abort = new AbortController();
  request.once("aborted", () => abort.abort());
  response.once("close", () => { if (!response.writableEnded) abort.abort(); });
  return AbortSignal.any([abort.signal, AbortSignal.timeout(timeoutMs)]);
}

async function boundedText(response: Response): Promise<string | null> {
  const declared = Number(response.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > MAX_UPSTREAM_BYTES) return null;
  if (!response.body) return "";
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_UPSTREAM_BYTES) { await reader.cancel(); return null; }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString("utf8");
}
function redact(value: string, secret: string): string { return secret ? value.replaceAll(secret, "[REDACTED]") : value; }

function discoveryHeaders(api: string, apiKey: string | undefined, configured: Record<string, string>): Headers {
  const headers = new Headers(configured);
  if (!headers.has("accept")) headers.set("accept", "application/json");
  if (!apiKey) return headers;
  if (api === "anthropic-messages") {
    if (!headers.has("x-api-key")) headers.set("x-api-key", apiKey);
    if (!headers.has("anthropic-version")) headers.set("anthropic-version", "2023-06-01");
  } else if (api === "google-generative-ai") {
    if (!headers.has("x-goog-api-key")) headers.set("x-goog-api-key", apiKey);
  } else if (!headers.has("authorization")) headers.set("authorization", `Bearer ${apiKey}`);
  return headers;
}

async function discover(request: IncomingMessage, response: ServerResponse): Promise<void> {
  let secret = "";
  try {
    const value = await body(request);
    const name = typeof value.providerName === "string" ? value.providerName.trim() : "";
    if (!name) { send(response, 400, { error: "providerName is required" }); return; }
    if (!record(value.provider)) { send(response, 400, { error: "provider is required" }); return; }
    const provider = providerWithStoredKey(name, value.provider);
    const baseUrl = typeof provider.baseUrl === "string" ? provider.baseUrl.trim() : "";
    if (!baseUrl) { send(response, 400, { error: "Base URL is required" }); return; }
    const api = typeof provider.api === "string" && provider.api ? provider.api : "openai-completions";
    let endpoint;
    try { endpoint = buildModelsListUrl(baseUrl, api); } catch { send(response, 400, { error: "Base URL is invalid" }); return; }
    const auth = await resolveModelDiscoveryAuth(name, provider);
    secret = auth.apiKey ?? "";
    if (typeof provider.apiKey === "string" && provider.apiKey.trim() && !secret) { send(response, 400, { error: `No API key found for "${name}"` }); return; }
    const upstream = await fetch(endpoint, { cache: "no-store", headers: discoveryHeaders(api, secret, auth.headers), signal: requestSignal(request, response, 20_000) });
    const text = await boundedText(upstream);
    if (text === null) { send(response, 502, { error: "Upstream model list is too large" }); return; }
    if (!upstream.ok) { send(response, 502, { error: redact(text.slice(0, 500), secret) || `Upstream returned HTTP ${upstream.status}`, status: upstream.status }); return; }
    let payload;
    try { payload = JSON.parse(text); } catch { send(response, 502, { error: "Upstream model list was not valid JSON" }); return; }
    const found = parseDiscoveredModels(payload);
    if (!found.length) { send(response, 502, { error: "No models found in the upstream response" }); return; }
    send(response, 200, { models: found, endpoint: endpoint.toString() });
  } catch (error) {
    const status = error instanceof DOMException && error.name === "TimeoutError" ? 504 : 500;
    send(response, status, { error: redact(error instanceof Error ? error.message : String(error), secret) });
  }
}

function cache(): CatalogCache { return globalThis.__piModelsDevCatalogCache ??= { entries: [], expiresAt: 0 }; }
async function catalogEntries(): Promise<ModelCatalogEntry[]> {
  const state = cache();
  if (state.entries.length && state.expiresAt > Date.now()) return state.entries;
  if (!state.inFlight) state.inFlight = fetch(MODELS_DEV_URL, { cache: "no-store", headers: { accept: "application/json" }, signal: AbortSignal.timeout(15_000) })
    .then(async (response) => {
      if (!response.ok) throw new Error(`models.dev returned HTTP ${response.status}`);
      const text = await boundedText(response);
      if (text === null) throw new Error("models.dev returned an oversized catalog");
      const entries = flattenModelsDevCatalog(JSON.parse(text));
      if (!entries.length) throw new Error("models.dev returned an empty catalog");
      state.entries = entries; state.expiresAt = Date.now() + 3_600_000; return entries;
    }).finally(() => { state.inFlight = undefined; });
  try { return await state.inFlight; } catch (error) { if (state.entries.length) return state.entries; throw error; }
}
async function catalog(request: IncomingMessage, response: ServerResponse): Promise<void> {
  const params = new URL(request.url!, "http://internal").searchParams;
  const query = (params.get("q") ?? "").slice(0, 120), provider = (params.get("provider") ?? "").slice(0, 120), baseUrl = (params.get("baseUrl") ?? "").slice(0, 500);
  const parsed = Number.parseInt(params.get("limit") ?? "50", 10), limit = Number.isFinite(parsed) ? parsed : 50;
  try {
    const entries = await catalogEntries();
    send(response, 200, { models: searchModelCatalog(entries, query, provider, limit), recommendation: recommendModelCatalogPreset(entries, query, provider, baseUrl), source: MODELS_DEV_URL });
  } catch (error) { send(response, 502, { error: error instanceof Error ? error.message : String(error) }); }
}

function assistantText(message: AssistantMessage): string {
  return message.content.filter((block) => block.type === "text").map((block) => block.text).join("");
}
async function testModel(request: IncomingMessage, response: ServerResponse): Promise<void> {
  let temp: string | undefined;
  let secret = "";
  try {
    const value = await body(request);
    const name = typeof value.providerName === "string" ? value.providerName.trim() : "";
    if (!name) { send(response, 400, { ok: false, error: "providerName is required" }); return; }
    if (!record(value.provider)) { send(response, 400, { ok: false, error: "provider is required" }); return; }
    if (!record(value.model)) { send(response, 400, { ok: false, error: "model is required" }); return; }
    const modelId = typeof value.model.id === "string" ? value.model.id.trim() : "";
    if (!modelId) { send(response, 400, { ok: false, error: "Model ID is required" }); return; }
    const provider = providerWithStoredKey(name, value.provider);
    secret = typeof provider.apiKey === "string" && provider.apiKey !== MASKED_API_KEY ? provider.apiKey : "";
    temp = mkdtempSync(join(tmpdir(), "pi-web-model-test-"));
    const modelsPath = join(temp, "models.json");
    writeFileSync(modelsPath, JSON.stringify({ providers: { [name]: { ...provider, models: [{ ...value.model, id: modelId }] } } }, null, 2), { mode: 0o600 });
    const runtime = await ModelRuntime.create({ modelsPath });
    if (runtime.getError()) { send(response, 200, { ok: false, error: runtime.getError() }); return; }
    const model = runtime.getModel(name, modelId);
    if (!model) { send(response, 200, { ok: false, error: `Model not found: ${name}/${modelId}` }); return; }
    const auth = await runtime.getAuth(model);
    if (!auth?.auth.apiKey) { send(response, 200, { ok: false, error: `No API key found for "${name}"` }); return; }
    secret = auth.auth.apiKey;
    const started = Date.now(); let status: number | undefined;
    const message = await completeSimple(model, { messages: [{ role: "user", content: "Reply with OK only.", timestamp: Date.now() }] }, {
      apiKey: secret, headers: auth.auth.headers, maxTokens: 16, timeoutMs: 20_000, maxRetries: 0, cacheRetention: "none", signal: requestSignal(request, response, 20_000),
      onResponse: (upstream) => { status = upstream.status; },
    });
    const latencyMs = Date.now() - started;
    if (message.stopReason === "error" || message.stopReason === "aborted") { send(response, 200, { ok: false, error: redact(message.errorMessage ?? "Model returned an error", secret), latencyMs, status }); return; }
    send(response, 200, { ok: true, latencyMs, status, responseText: redact(assistantText(message).slice(0, 300), secret) });
  } catch (error) { send(response, 500, { ok: false, error: redact(error instanceof Error ? error.message : String(error), secret) }); }
  finally { if (temp) rmSync(temp, { recursive: true, force: true }); }
}

export async function routeModels(request: IncomingMessage, response: ServerResponse, path: string): Promise<boolean> {
  if (request.method === "GET" && path === "/internal/v1/api/models") { await models(request, response); return true; }
  if (path === "/internal/v1/api/models-config" && (request.method === "GET" || request.method === "PUT")) { await config(request, response); return true; }
  if (request.method === "POST" && path === "/internal/v1/api/models-config/discover") { await discover(request, response); return true; }
  if (request.method === "GET" && path === "/internal/v1/api/models-config/catalog") { await catalog(request, response); return true; }
  if (request.method === "POST" && path === "/internal/v1/api/models-config/test") { await testModel(request, response); return true; }
  return false;
}
