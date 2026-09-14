import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { writePrivateFileAtomicSync } from "./atomic-file.js";
import { invalidateModelsCache } from "./models-cache.js";

const MODEL_COST_KEYS = ["input", "output", "cacheRead", "cacheWrite"] as const;
export const MASKED_API_KEY = "__PI_AGENT_MASKED_API_KEY__";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizeModelCost(value: unknown): Record<string, unknown> | undefined {
  if (!isRecord(value)) return undefined;
  const providedKeys = MODEL_COST_KEYS.filter((key) => value[key] !== undefined);
  if (providedKeys.length === 0) return undefined;
  if (providedKeys.some((key) => (
    typeof value[key] !== "number" || !Number.isFinite(value[key])
  ))) return undefined;

  return Object.fromEntries([
    ...Object.entries(value),
    ...MODEL_COST_KEYS.map((key) => [key, value[key] ?? 0]),
  ]);
}

/** Complete partial cost groups with zero; omit a cost group only when it is empty. */
export function normalizeModelsConfigCosts(
  data: Record<string, unknown>,
): Record<string, unknown> {
  const normalized = structuredClone(data);
  if (!isRecord(normalized.providers)) return normalized;

  for (const provider of Object.values(normalized.providers)) {
    if (!isRecord(provider) || !Array.isArray(provider.models)) continue;
    for (const model of provider.models) {
      if (!isRecord(model) || !("cost" in model)) continue;
      const cost = normalizeModelCost(model.cost);
      if (cost) model.cost = cost;
      else delete model.cost;
    }
  }
  return normalized;
}

function sanitizeModelsConfig(data: Record<string, unknown>): Record<string, unknown> {
  if (!isRecord(data.providers)) return data;

  const providers = Object.fromEntries(Object.entries(data.providers).map(([providerId, provider]) => {
    if (!isRecord(provider) || !Array.isArray(provider.models)) return [providerId, provider];
    const models = provider.models.filter((model) => (
      !isRecord(model) || typeof model.id !== "string" || model.id.trim().length > 0
    ));
    return [providerId, { ...provider, models }];
  }));

  return { ...data, providers };
}

export function getModelsConfigPath(): string {
  return join(getAgentDir(), "models.json");
}

export function readModelsConfig(
  modelsPath = getModelsConfigPath(),
): Record<string, unknown> {
  if (!existsSync(modelsPath)) return { providers: {} };
  try {
    return JSON.parse(readFileSync(modelsPath, "utf8")) as Record<string, unknown>;
  } catch {
    return { providers: {} };
  }
}

export function maskModelsConfig(data: Record<string, unknown>): Record<string, unknown> {
  const masked = structuredClone(data);
  if (!isRecord(masked.providers)) return masked;
  for (const provider of Object.values(masked.providers)) {
    if (isRecord(provider) && typeof provider.apiKey === "string" && provider.apiKey) provider.apiKey = MASKED_API_KEY;
  }
  return masked;
}

function effectiveApi(value: unknown): string {
  return typeof value === "string" && value ? value : "openai-completions";
}

function restoreMaskedApiKeys(data: Record<string, unknown>, current: Record<string, unknown>): Record<string, unknown> {
  const restored = structuredClone(data);
  if (!isRecord(restored.providers) || !isRecord(current.providers)) return restored;
  for (const [providerId, provider] of Object.entries(restored.providers)) {
    if (!isRecord(provider) || provider.apiKey !== MASKED_API_KEY) continue;
    const existing = current.providers[providerId];
    if (isRecord(existing) && existing.baseUrl === provider.baseUrl && effectiveApi(existing.api) === effectiveApi(provider.api) && typeof existing.apiKey === "string") {
      provider.apiKey = existing.apiKey;
    } else delete provider.apiKey;
  }
  return restored;
}

export function writeModelsConfig(
  data: Record<string, unknown>,
  modelsPath = getModelsConfigPath(),
): void {
  const dir = dirname(modelsPath);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const restored = restoreMaskedApiKeys(data, readModelsConfig(modelsPath));
  const normalized = normalizeModelsConfigCosts(sanitizeModelsConfig(restored));
  writePrivateFileAtomicSync(modelsPath, JSON.stringify(normalized, null, 2));
  invalidateModelsCache();
}
