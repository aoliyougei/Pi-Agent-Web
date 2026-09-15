import { MAX_JSON_BYTES } from "@aoliyougei/pi-agent-contract";
import { readJsonBody } from "@/lib/agent-rpc/proxy";
import { remotePushRoutes } from "@/lib/agent-rpc/routes/push-instance";
import { isApiRequestAllowed } from "@/lib/request-security";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  if (!isApiRequestAllowed(request)) return Response.json({ error: "Untrusted API request" }, { status: 403 });
  const declared = Number(request.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > MAX_JSON_BYTES) return Response.json({ error: "Request body too large" }, { status: 413 });
  let body: unknown;
  try {
    const bytes = await readJsonBody(request);
    if (bytes === null) return Response.json({ error: "Request body too large" }, { status: 413 });
    body = JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) return Response.json({ error: "Invalid push subscription" }, { status: 400 });
  const { subscription, locale } = body as { subscription?: unknown; locale?: unknown };
  if (!subscription || typeof subscription !== "object" || Array.isArray(subscription)) return Response.json({ error: "Invalid push subscription" }, { status: 400 });
  const { endpoint, keys } = subscription as { endpoint?: unknown; keys?: unknown };
  if (typeof endpoint !== "string" || !/^https:\/\//.test(endpoint) || !keys || typeof keys !== "object" || Array.isArray(keys)) return Response.json({ error: "Invalid push subscription" }, { status: 400 });
  const { p256dh, auth } = keys as { p256dh?: unknown; auth?: unknown };
  if (typeof p256dh !== "string" || !p256dh || typeof auth !== "string" || !auth) return Response.json({ error: "Invalid push subscription" }, { status: 400 });
  const headers = new Headers(request.headers);
  headers.set("content-type", "application/json");
  return remotePushRoutes.SUBSCRIBE(new Request(request.url, {
    method: "POST",
    headers,
    body: JSON.stringify({ subscription: { endpoint, keys: { p256dh, auth } }, locale }),
    signal: request.signal,
  }));
}
