import { MAX_JSON_BYTES } from "@aoliyougei/pi-agent-contract";
import { proxyError } from "./errors";

export type AgentFetch = (path: string, init?: RequestInit) => Promise<Response>;

// Browser identity and arbitrary proxy headers never cross the service boundary.
const REQUEST_HEADERS = ["content-type", "accept", "last-event-id", "range", "x-request-id"];
const RESPONSE_HEADERS = ["content-type", "content-disposition", "cache-control", "x-request-id", "x-accel-buffering", "retry-after"];

/** Transparent, single-attempt transport for JSON, SSE and file streams. */
export async function proxyAgentRequest(
  request: Request,
  path: string,
  send: AgentFetch,
  responseHeaders: readonly string[] = RESPONSE_HEADERS,
): Promise<Response> {
  if (request.signal.aborted) return new Response(null, { status: 204 });
  const headers = new Headers();
  for (const name of REQUEST_HEADERS) {
    const value = request.headers.get(name);
    if (value !== null) headers.set(name, value);
  }
  try {
    const hasBody = request.method !== "GET" && request.method !== "HEAD" && request.body !== null;
    const init: RequestInit & { duplex?: "half" } = {
      method: request.method, headers, signal: request.signal, cache: "no-store", redirect: "manual",
      ...(hasBody ? { body: request.body, duplex: "half" } : {}),
    };
    const upstream = await send(path, init);
    if (upstream.status >= 300 && upstream.status < 400) {
      await upstream.body?.cancel();
      return proxyError(502, "Invalid Agent response", "agent_bad_gateway");
    }
    const outgoing = new Headers();
    const hopHeaders = new Set((upstream.headers.get("connection") ?? "").toLowerCase().split(",").map((name) => name.trim()));
    for (const name of responseHeaders) {
      const value = upstream.headers.get(name);
      if (value !== null && !hopHeaders.has(name)) outgoing.set(name, value);
    }
    // Reuse the fetch body: backpressure/cancellation stay native, without parsing SSE or buffering downloads.
    return new Response(upstream.body, { status: upstream.status, statusText: upstream.statusText, headers: outgoing });
  } catch {
    if (request.signal.aborted) return new Response(null, { status: 204 });
    // An interrupted POST may already have run. Never invent accepted:false or retry it here.
    return proxyError(503, "Agent service unavailable", "agent_unavailable");
  }
}

export async function readJsonBody(request: Request): Promise<ArrayBuffer | null> {
  const reader = request.body!.getReader();
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  for (;;) {
    const chunk = await reader.read();
    if (chunk.done) {
      const body = new Uint8Array(bytes);
      let offset = 0;
      for (const value of chunks) {
        body.set(value, offset);
        offset += value.byteLength;
      }
      return body.buffer;
    }
    bytes += chunk.value.byteLength;
    if (bytes > MAX_JSON_BYTES) {
      await reader.cancel();
      return null;
    }
    chunks.push(chunk.value);
  }
}

export async function proxyJson(request: Request, path: string, send: AgentFetch): Promise<Response> {
  const hasBody = request.method !== "GET" && request.method !== "HEAD" && request.body !== null;
  if (!hasBody) return proxyAgentRequest(request, path, send);
  if (request.headers.get("content-type")?.split(";", 1)[0].trim().toLowerCase() !== "application/json") {
    return proxyError(415, "Content-Type must be application/json", "invalid_request");
  }
  const length = Number(request.headers.get("content-length"));
  if (Number.isFinite(length) && length > MAX_JSON_BYTES) {
    return proxyError(413, "Request body too large", "request_too_large");
  }
  let body: ArrayBuffer | null;
  try {
    body = await readJsonBody(request);
  } catch {
    return request.signal.aborted
      ? new Response(null, { status: 204 })
      : proxyError(400, "Invalid request body", "invalid_request");
  }
  if (body === null) return proxyError(413, "Request body too large", "request_too_large");
  return proxyAgentRequest(new Request(request, { body }), path, send);
}
