import type { IncomingMessage, ServerResponse } from "node:http";
import {
  addSubscription,
  getVapidPublicKey,
  type PushSubscriptionRecord,
} from "../dependencies/web-push.js";
import { readJson } from "./agent.js";

export interface PushAdapter {
  getVapidPublicKey(): Promise<string>;
  addSubscription(subscription: PushSubscriptionRecord): Promise<void>;
}

const defaultAdapter: PushAdapter = { getVapidPublicKey, addSubscription };

function send(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
  response.end(JSON.stringify(body));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function subscription(value: unknown, locale: unknown): PushSubscriptionRecord | null {
  if (!isRecord(value) || typeof value.endpoint !== "string" || !/^https:\/\//.test(value.endpoint) || !isRecord(value.keys)) return null;
  const { p256dh, auth } = value.keys;
  if (typeof p256dh !== "string" || !p256dh || typeof auth !== "string" || !auth) return null;
  return { endpoint: value.endpoint, keys: { p256dh, auth }, locale: locale === "zh-CN" ? "zh-CN" : "en" };
}

export async function routePush(
  request: IncomingMessage,
  response: ServerResponse,
  path: string,
  adapter: PushAdapter = defaultAdapter,
): Promise<boolean> {
  if (request.method === "GET" && path === "/internal/v1/api/push/config") {
    send(response, 200, { publicKey: await adapter.getVapidPublicKey() });
    return true;
  }
  if (request.method !== "POST" || path !== "/internal/v1/api/push/subscribe") return false;
  try {
    const { value } = await readJson(request);
    const body = isRecord(value) ? value : {};
    const parsed = subscription(body.subscription, body.locale);
    if (!parsed) { send(response, 400, { error: "Invalid push subscription" }); return true; }
    await adapter.addSubscription(parsed);
    send(response, 200, { ok: true });
  } catch (error) {
    const status = typeof error === "object" && error && "status" in error ? Number(error.status) : 500;
    send(response, status, { error: status < 500 && error instanceof Error ? error.message : "Unable to save push subscription" });
  }
  return true;
}
