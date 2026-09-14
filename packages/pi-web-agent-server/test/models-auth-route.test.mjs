import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { once } from "node:events";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createAgentServer } from "../dist/server.js";
import { allowFileRoot } from "../dist/dependencies/allowed-roots.js";

const token = "models-auth-token";
const agentDir = mkdtempSync(join(tmpdir(), "pi-models-auth-"));
process.env.PI_CODING_AGENT_DIR = agentDir;
test.after(() => rmSync(agentDir, { recursive: true, force: true }));

function fakeRuntime() {
  const apiKey = {
    name: "Dual API key",
    async login({ prompt }) {
      const key = await prompt({ type: "secret", message: "API key" });
      if (key === "leaky-secret") throw new Error(`Rejected ${key}`);
      return { type: "api_key", key };
    },
  };
  const oauth = { name: "Dual OAuth" };
  const provider = { id: "dual", name: "Dual Provider", auth: { apiKey, oauth } };
  return {
    getProvider: (id) => id === "dual" ? provider : undefined,
    getProviders: () => [provider, provider],
    getModels: () => [
      { provider: "dual", id: "one" },
      { provider: "dual", id: "two" },
    ],
    getProviderAuthStatus: () => ({ configured: true, source: "stored" }),
    listCredentials: async () => [{ providerId: "dual", type: "api_key" }],
    async login(id, type, interaction) {
      assert.equal(id, "dual");
      assert.equal(type, "oauth");
      interaction.notify({ type: "auth_url", url: "https://login.example.test", instructions: "Open it" });
      interaction.notify({ type: "device_code", userCode: "ABCD", verificationUri: "https://device.example.test", intervalSeconds: 2, expiresInSeconds: 60 });
      const firstCode = await interaction.prompt({ type: "manual_code", message: "Paste code", placeholder: "code" });
      assert.equal(firstCode, "returned-code");
      const secondCode = await interaction.prompt({ type: "manual_code", message: "Paste second code", placeholder: "code" });
      assert.equal(secondCode, "second-code");
      return { type: "oauth", access: "oauth-secret", refresh: "refresh-secret", expires: Date.now() + 60_000 };
    },
  };
}

async function start(t) {
  const runtime = fakeRuntime();
  const app = createAgentServer({
    token,
    version: { protocolVersion: 1 },
    modelAuth: { createRuntime: async () => runtime },
  });
  await app.listen("127.0.0.1", 0);
  t.after(() => app.close());
  return `http://127.0.0.1:${app.address().port}`;
}

function request(base, path, init = {}) {
  return fetch(base + path, {
    ...init,
    headers: { authorization: `Bearer ${token}`, ...(init.body ? { "content-type": "application/json" } : {}), ...init.headers },
  });
}

async function json(response) {
  return { status: response.status, body: await response.json() };
}

test("Agent owns API keys, type-aware deletion, and deduplicated provider listing", async (t) => {
  const base = await start(t);
  const authPath = join(agentDir, "auth.json");
  writeFileSync(authPath, "{}", { mode: 0o600 });
  const secret = "agent-only-api-secret";

  const savedResponse = await request(base, "/internal/v1/api/auth/api-key/dual", {
    method: "POST",
    body: JSON.stringify({ apiKey: secret }),
  });
  const savedText = await savedResponse.text();
  assert.equal(savedResponse.status, 200);
  assert.deepEqual(JSON.parse(savedText), { success: true });
  assert.equal(savedText.includes(secret), false);
  assert.equal(JSON.parse(readFileSync(authPath, "utf8")).dual.key, secret);

  const rejected = await json(await request(base, "/internal/v1/api/auth/api-key/dual", {
    method: "POST",
    body: JSON.stringify({ apiKey: "leaky-secret" }),
  }));
  assert.equal(rejected.status, 500);
  assert.equal(JSON.stringify(rejected.body).includes("leaky-secret"), false);

  const providers = await json(await request(base, "/internal/v1/api/auth/providers"));
  assert.equal(providers.status, 200);
  assert.equal(providers.body.apiKeyProviders.filter((entry) => entry.id === "dual").length, 1);
  assert.equal(providers.body.oauthProviders.filter((entry) => entry.id === "dual").length, 1);
  assert.equal(JSON.stringify(providers.body).includes(secret), false);

  writeFileSync(authPath, JSON.stringify({ dual: { type: "oauth", access: "oauth-secret", refresh: "refresh-secret" } }), { mode: 0o600 });
  assert.deepEqual(await json(await request(base, "/internal/v1/api/auth/api-key/dual", { method: "DELETE" })), {
    status: 409,
    body: { error: "dual is authenticated with OAuth, not an API key" },
  });
  assert.equal(JSON.parse(readFileSync(authPath, "utf8")).dual.access, "oauth-secret");

  assert.deepEqual(await json(await request(base, "/internal/v1/api/auth/logout/dual", { method: "POST" })), {
    status: 200,
    body: { ok: true },
  });
  assert.deepEqual(JSON.parse(readFileSync(authPath, "utf8")), {});
});

test("models config masks API keys while preserving atomic whole-config saves", async (t) => {
  const base = await start(t);
  const modelsPath = join(agentDir, "models.json");
  const secret = "models-json-agent-only-secret";
  const config = {
    providers: {
      acme: {
        apiKey: secret,
        models: [{ id: "kept", cost: { input: 2 } }, { id: " " }],
      },
    },
  };

  assert.deepEqual(await json(await request(base, "/internal/v1/api/models-config", {
    method: "PUT",
    body: JSON.stringify(config),
  })), { status: 200, body: { success: true } });
  const persisted = JSON.parse(readFileSync(modelsPath, "utf8"));
  assert.equal(persisted.providers.acme.apiKey, secret);
  assert.deepEqual(persisted.providers.acme.models, [{
    id: "kept",
    cost: { input: 2, output: 0, cacheRead: 0, cacheWrite: 0 },
  }]);
  if (process.platform !== "win32") assert.equal(statSync(modelsPath).mode & 0o777, 0o600);

  const shown = await json(await request(base, "/internal/v1/api/models-config"));
  assert.equal(shown.status, 200);
  assert.equal(JSON.stringify(shown.body).includes(secret), false);
  assert.equal(typeof shown.body.providers.acme.apiKey, "string");

  shown.body.providers.acme.api = "openai-completions";
  shown.body.providers.acme.models.push({ id: "second" });
  assert.deepEqual(await json(await request(base, "/internal/v1/api/models-config", {
    method: "PUT",
    body: JSON.stringify(shown.body),
  })), { status: 200, body: { success: true } });
  const resaved = JSON.parse(readFileSync(modelsPath, "utf8"));
  assert.equal(resaved.providers.acme.apiKey, secret);
  assert.deepEqual(resaved.providers.acme.models.map((model) => model.id), ["kept", "second"]);

  shown.body.providers.acme.baseUrl = "https://changed.example.invalid";
  assert.equal((await json(await request(base, "/internal/v1/api/models-config", {
    method: "PUT",
    body: JSON.stringify(shown.body),
  }))).status, 200);
  assert.equal("apiKey" in JSON.parse(readFileSync(modelsPath, "utf8")).providers.acme, false,
    "a masked key must not be rebound to a changed upstream destination");

  writeFileSync(modelsPath, "{broken", { mode: 0o600 });
  assert.deepEqual(await json(await request(base, "/internal/v1/api/models-config")), {
    status: 200,
    body: { providers: {} },
  });
});

test("model listing, discovery, catalog, and connection testing stay inside Agent", async (t) => {
  let authorization;
  const upstream = createServer(async (request, response) => {
    if (request.method === "GET" && request.url === "/models") {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ data: [{ id: "local-model", display_name: "Local Model" }] }));
      return;
    }
    if (request.method === "GET" && request.url === "/reflect/models") {
      response.writeHead(401, { "content-type": "text/plain" });
      response.end("Rejected local-model-secret");
      return;
    }
    if (request.method === "GET" && request.url === "/oversized/models") {
      response.writeHead(200, { "content-type": "application/json" });
      response.end("x".repeat(2 * 1024 * 1024 + 1));
      return;
    }
    if (request.method === "POST" && request.url === "/error/chat/completions") {
      authorization = request.headers.authorization;
      for await (const chunk of request) void chunk;
      response.writeHead(401, { "content-type": "text/plain" });
      response.end("Rejected local-model-secret");
      return;
    }
    if (request.method === "POST" && request.url === "/chat/completions") {
      authorization = request.headers.authorization;
      for await (const chunk of request) void chunk;
      response.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache" });
      response.write(`data: ${JSON.stringify({ id: "chatcmpl-test", object: "chat.completion.chunk", created: 0, model: "local-model", choices: [{ index: 0, delta: { role: "assistant", content: "OK" }, finish_reason: null }] })}\n\n`);
      response.write(`data: ${JSON.stringify({ id: "chatcmpl-test", object: "chat.completion.chunk", created: 0, model: "local-model", choices: [{ index: 0, delta: {}, finish_reason: "stop" }], usage: { prompt_tokens: 1, completion_tokens: 1 } })}\n\n`);
      response.end("data: [DONE]\n\n");
      return;
    }
    response.writeHead(404).end();
  });
  upstream.listen(0, "127.0.0.1");
  await once(upstream, "listening");
  t.after(() => new Promise((resolve) => upstream.close(resolve)));
  const upstreamUrl = `http://127.0.0.1:${upstream.address().port}`;
  const base = await start(t);
  const secret = "local-model-secret";
  const provider = {
    baseUrl: upstreamUrl,
    api: "openai-completions",
    apiKey: secret,
    models: [{ id: "local-model", name: "Local Model", contextWindow: 4096, maxTokens: 256 }],
  };
  writeFileSync(join(agentDir, "models.json"), JSON.stringify({ providers: { local: provider } }), { mode: 0o600 });
  allowFileRoot(agentDir);

  const models = await json(await request(base, `/internal/v1/api/models?cwd=${encodeURIComponent(agentDir)}`));
  assert.equal(models.status, 200);
  assert.deepEqual(models.body.modelList, [{ id: "local-model", name: "Local Model", provider: "local" }]);
  assert.equal(JSON.stringify(models.body).includes(secret), false);

  writeFileSync(join(agentDir, "models.json"), JSON.stringify({ providers: { local: { ...provider, api: undefined } } }), { mode: 0o600 });
  const maskedProvider = (await json(await request(base, "/internal/v1/api/models-config"))).body.providers.local;
  const discovered = await json(await request(base, "/internal/v1/api/models-config/discover", {
    method: "POST",
    body: JSON.stringify({ providerName: "local", provider: { ...maskedProvider, api: "openai-completions", models: undefined } }),
  }));
  assert.deepEqual(discovered, {
    status: 200,
    body: { models: [{ id: "local-model", name: "Local Model" }], endpoint: `${upstreamUrl}/models` },
  });
  assert.equal(JSON.stringify(discovered.body).includes(secret), false);

  const reflected = await json(await request(base, "/internal/v1/api/models-config/discover", {
    method: "POST",
    body: JSON.stringify({ providerName: "local", provider: { ...provider, baseUrl: `${upstreamUrl}/reflect`, models: undefined } }),
  }));
  assert.equal(reflected.status, 502);
  assert.equal(JSON.stringify(reflected.body).includes(secret), false);

  assert.deepEqual(await json(await request(base, "/internal/v1/api/models-config/discover", {
    method: "POST",
    body: JSON.stringify({ providerName: "local", provider: { ...provider, baseUrl: `${upstreamUrl}/oversized`, models: undefined } }),
  })), { status: 502, body: { error: "Upstream model list is too large" } });

  globalThis.__piModelsDevCatalogCache = {
    entries: [{ key: "local/local-model", providerId: "local", providerName: "Local", id: "local-model", name: "Local Model", cost: { input: 1, output: 2 } }],
    expiresAt: Date.now() + 60_000,
  };
  t.after(() => { globalThis.__piModelsDevCatalogCache = undefined; });
  const catalog = await json(await request(base, "/internal/v1/api/models-config/catalog?q=local-model&provider=local&limit=1"));
  assert.equal(catalog.status, 200);
  assert.equal(catalog.body.models[0].id, "local-model");
  assert.equal(catalog.body.recommendation.price.status, "reliable");

  const shown = (await json(await request(base, "/internal/v1/api/models-config"))).body;
  const tested = await json(await request(base, "/internal/v1/api/models-config/test", {
    method: "POST",
    body: JSON.stringify({ providerName: "local", provider: { ...shown.providers.local, api: "openai-completions" }, model: provider.models[0] }),
  }));
  assert.equal(tested.status, 200);
  assert.equal(tested.body.ok, true);
  assert.equal(tested.body.responseText, "OK");
  assert.equal(authorization, `Bearer ${secret}`);
  assert.equal(JSON.stringify(tested.body).includes(secret), false);

  const failedTest = await json(await request(base, "/internal/v1/api/models-config/test", {
    method: "POST",
    body: JSON.stringify({ providerName: "local", provider: { ...provider, baseUrl: `${upstreamUrl}/error` }, model: provider.models[0] }),
  }));
  assert.equal(failedTest.status, 200);
  assert.equal(failedTest.body.ok, false);
  assert.equal(JSON.stringify(failedTest.body).includes(secret), false);

  upstream.removeAllListeners("request");
  upstream.on("request", (_request, response) => response.end("not-json"));
  assert.deepEqual(await json(await request(base, "/internal/v1/api/models-config/discover", {
    method: "POST",
    body: JSON.stringify({ providerName: "local", provider: { ...provider, models: undefined } }),
  })), { status: 502, body: { error: "Upstream model list was not valid JSON" } });
});

test("OAuth SSE streams provider events and accepts manual input", async (t) => {
  const base = await start(t);
  const response = await request(base, "/internal/v1/api/auth/login/dual");
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("content-type"), "text/event-stream");
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let text = "";
  let tokenValue;
  while (!tokenValue) {
    const chunk = await reader.read();
    assert.equal(chunk.done, false);
    text += decoder.decode(chunk.value, { stream: true });
    const events = text.split("\n\n").filter(Boolean).map((entry) => JSON.parse(entry.slice("data: ".length)));
    tokenValue = events.find((event) => event.type === "auth")?.token;
  }
  assert.match(text, /"type":"device_code"/);
  assert.equal(text.includes("oauth-secret"), false);

  assert.deepEqual(await json(await request(base, "/internal/v1/api/auth/login/dual", {
    method: "POST",
    body: JSON.stringify({ token: tokenValue, code: "returned-code" }),
  })), { status: 200, body: { ok: true, provider: "dual" } });

  let secondToken;
  while (!secondToken) {
    const chunk = await reader.read();
    assert.equal(chunk.done, false);
    text += decoder.decode(chunk.value, { stream: true });
    const events = text.split("\n\n").filter(Boolean).map((entry) => JSON.parse(entry.slice("data: ".length)));
    secondToken = events.find((event) => event.type === "prompt_request" && event.message === "Paste second code")?.token;
  }
  assert.notEqual(secondToken, tokenValue);
  assert.deepEqual(await json(await request(base, "/internal/v1/api/auth/login/dual", {
    method: "POST",
    body: JSON.stringify({ token: secondToken, code: "second-code" }),
  })), { status: 200, body: { ok: true, provider: "dual" } });

  for (;;) {
    const chunk = await reader.read();
    if (chunk.done) break;
    text += decoder.decode(chunk.value, { stream: true });
  }
  assert.match(text, /"type":"success"/);
  assert.equal(text.includes("oauth-secret"), false);
});
