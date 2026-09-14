import type { IncomingMessage, ServerResponse } from "node:http";
import type { AuthEvent, AuthPrompt, Credential } from "@earendil-works/pi-ai";
import { ModelRuntime } from "@earendil-works/pi-coding-agent";
import { invalidateModelsCache } from "../dependencies/models-cache.js";
import { removeStoredCredentialIfType, storeProviderCredential } from "../dependencies/provider-credential-store.js";
import { buildApiKeyProviderList, buildOAuthProviderList } from "../dependencies/provider-listing.js";
import { collectProviderListingInputs } from "../dependencies/provider-listing-runtime.js";
import { readJson } from "./agent.js";

interface ProviderAuthRuntime {
  getProvider(id: string): { auth: { apiKey?: { login?: (interaction: AuthInteraction) => Promise<Credential> }; oauth?: unknown } } | undefined;
  getProviders(): readonly unknown[];
  getModels(): readonly { provider: string }[];
  getProviderAuthStatus(id: string): { configured: boolean; source?: string };
  listCredentials(): Promise<readonly { providerId: string; type: string }[]>;
  login(provider: string, type: "oauth", interaction: AuthInteraction): Promise<Credential>;
}

interface AuthInteraction {
  signal?: AbortSignal;
  prompt(prompt: AuthPrompt): Promise<string>;
  notify(event: AuthEvent): void;
}

export interface ModelAuthAdapter {
  createRuntime(): Promise<ProviderAuthRuntime>;
}

const defaultAdapter: ModelAuthAdapter = {
  createRuntime: () => ModelRuntime.create() as Promise<ProviderAuthRuntime>,
};
const PROVIDER = /^[A-Za-z0-9](?:[A-Za-z0-9._-]*[A-Za-z0-9])?$/;
const callbacks = new Map<string, { provider: string; resolve(value: string): void; reject(error: Error): void }>();

function send(response: ServerResponse, status: number, value: unknown): void {
  response.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(value));
}

function providerFrom(path: string, prefix: string): string | null {
  if (!path.startsWith(prefix)) return null;
  try {
    const provider = decodeURIComponent(path.slice(prefix.length));
    return PROVIDER.test(provider) ? provider : null;
  } catch { return null; }
}

async function jsonBody(request: IncomingMessage): Promise<Record<string, unknown>> {
  const value = (await readJson(request)).value;
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

async function apiKey(request: IncomingMessage, response: ServerResponse, provider: string, adapter: ModelAuthAdapter): Promise<void> {
  let submittedKey = "";
  try {
    if (request.method === "DELETE") {
      const removal = await removeStoredCredentialIfType(provider, "api_key");
      if (removal.status === "type_mismatch") { send(response, 409, { error: `${provider} is authenticated with OAuth, not an API key` }); return; }
      invalidateModelsCache();
      send(response, 200, { success: true });
      return;
    }
    const value = await jsonBody(request);
    const key = typeof value.apiKey === "string" ? value.apiKey.trim() : "";
    submittedKey = key;
    if (!key) { send(response, 400, { error: "apiKey is required" }); return; }
    const runtime = await adapter.createRuntime();
    const login = runtime.getProvider(provider)?.auth.apiKey?.login;
    if (!login) throw new Error(`${provider} does not support API key login`);
    let submitted = false;
    const abort = new AbortController();
    request.once("aborted", () => abort.abort());
    response.once("close", () => { if (!response.writableEnded) abort.abort(); });
    const credential = await login({
      signal: abort.signal,
      notify: () => {},
      prompt: async (prompt) => {
        if (prompt.type === "select") {
          const option = prompt.options.find((entry) => entry.id === "api-key" || entry.id === "bearer-token");
          if (option) return option.id;
          throw new Error(`${provider} requires interactive authentication setup`);
        }
        if (!submitted && prompt.type === "secret") { submitted = true; return key; }
        throw new Error(`${provider} requires additional authentication settings`);
      },
    });
    await storeProviderCredential(provider, credential);
    invalidateModelsCache();
    send(response, 200, { success: true });
  } catch (error) {
    const message = String(error);
    send(response, 500, { error: submittedKey ? message.replaceAll(submittedKey, "[REDACTED]") : message });
  }
}

async function providers(response: ServerResponse, adapter: ModelAuthAdapter): Promise<void> {
  const runtime = await adapter.createRuntime();
  const inputs = await collectProviderListingInputs(runtime as never);
  const oauthProviders = buildOAuthProviderList(inputs);
  const apiKeyProviders = buildApiKeyProviderList(inputs);
  send(response, 200, { providers: oauthProviders, oauthProviders, apiKeyProviders });
}

async function logout(response: ServerResponse, provider: string, adapter: ModelAuthAdapter): Promise<void> {
  const runtime = await adapter.createRuntime();
  if (!runtime.getProvider(provider)?.auth.oauth) { send(response, 400, { error: `Unknown provider: ${provider}` }); return; }
  const removal = await removeStoredCredentialIfType(provider, "oauth");
  if (removal.status === "type_mismatch") { send(response, 409, { error: `${provider} is authenticated with an API key, not OAuth` }); return; }
  invalidateModelsCache();
  send(response, 200, { ok: true });
}

function sse(response: ServerResponse, value: unknown): void {
  response.write(`data: ${JSON.stringify(value)}\n\n`);
}

async function loginStream(request: IncomingMessage, response: ServerResponse, provider: string, adapter: ModelAuthAdapter): Promise<void> {
  response.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache", connection: "keep-alive" });
  response.flushHeaders();
  const abort = new AbortController();
  const active = new Set<string>();
  let pending: { token: string; promise: Promise<string> } | undefined;
  const createInput = () => {
    const token = `${provider}-${crypto.randomUUID()}`;
    active.add(token);
    const promise = new Promise<string>((resolve, reject) => callbacks.set(token, {
      provider,
      resolve: (value) => { active.delete(token); callbacks.delete(token); resolve(value); },
      reject: (error) => { active.delete(token); callbacks.delete(token); reject(error); },
    }));
    return { token, promise };
  };
  const manual = () => {
    if (!pending) {
      const created = createInput();
      pending = created;
      created.promise.finally(() => { if (pending === created) pending = undefined; }).catch(() => {});
    }
    return pending;
  };
  const cleanup = () => {
    for (const token of active) callbacks.get(token)?.reject(new Error("Login cancelled"));
    active.clear();
  };
  response.once("close", () => abort.abort());
  abort.signal.addEventListener("abort", cleanup, { once: true });
  try {
    const runtime = await adapter.createRuntime();
    if (!runtime.getProvider(provider)?.auth.oauth) { sse(response, { type: "error", message: `Unknown provider: ${provider}` }); return; }
    await runtime.login(provider, "oauth", {
      signal: abort.signal,
      prompt: async (prompt) => {
        const input = prompt.type === "manual_code" ? manual() : createInput();
        sse(response, prompt.type === "select"
          ? { type: "select_request", message: prompt.message, options: prompt.options, token: input.token }
          : { type: "prompt_request", message: prompt.message, placeholder: prompt.placeholder ?? null, token: input.token });
        return input.promise;
      },
      notify: (event) => {
        if (event.type === "auth_url") {
          const input = manual();
          sse(response, { type: "auth", url: event.url, instructions: event.instructions ?? null, token: input.token });
        } else if (event.type === "device_code") {
          sse(response, { type: "device_code", userCode: event.userCode, verificationUri: event.verificationUri, intervalSeconds: event.intervalSeconds ?? null, expiresInSeconds: event.expiresInSeconds ?? null });
        } else sse(response, { type: "progress", message: event.message });
      },
    });
    invalidateModelsCache();
    sse(response, { type: "success" });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    sse(response, message === "Login cancelled" ? { type: "cancelled" } : { type: "error", message });
  } finally {
    cleanup();
    response.end();
  }
}

async function loginInput(request: IncomingMessage, response: ServerResponse, provider: string): Promise<void> {
  const value = await jsonBody(request);
  const token = typeof value.token === "string" ? value.token : "";
  const code = typeof value.code === "string" ? value.code : "";
  if (!token || !code) { send(response, 400, { error: "token and code required" }); return; }
  const callback = callbacks.get(token);
  if (!callback) { send(response, 404, { error: "No pending login for token" }); return; }
  if (callback.provider !== provider) { send(response, 400, { error: "Token does not match provider" }); return; }
  callback.resolve(code);
  send(response, 200, { ok: true, provider });
}

export async function routeAuth(request: IncomingMessage, response: ServerResponse, path: string, adapter = defaultAdapter): Promise<boolean> {
  if (request.method === "GET" && path === "/internal/v1/api/auth/providers") { await providers(response, adapter); return true; }
  const keyProvider = providerFrom(path, "/internal/v1/api/auth/api-key/");
  if (keyProvider && (request.method === "POST" || request.method === "DELETE")) { await apiKey(request, response, keyProvider, adapter); return true; }
  const logoutProvider = providerFrom(path, "/internal/v1/api/auth/logout/");
  if (logoutProvider && request.method === "POST") { await logout(response, logoutProvider, adapter); return true; }
  const loginProvider = providerFrom(path, "/internal/v1/api/auth/login/");
  if (loginProvider && request.method === "GET") { await loginStream(request, response, loginProvider, adapter); return true; }
  if (loginProvider && request.method === "POST") { await loginInput(request, response, loginProvider); return true; }
  return false;
}
