export type AgentFetch = (path: string, init?: RequestInit) => Promise<Response>;

// Browser identity and arbitrary proxy headers never cross the service boundary.
const REQUEST_HEADERS = ["content-type", "accept", "last-event-id", "x-request-id"];
const RESPONSE_HEADERS = ["content-type", "content-disposition", "cache-control", "x-request-id", "x-accel-buffering", "retry-after"];

/** Transparent, single-attempt transport for JSON, SSE and file streams. */
export async function proxyAgentRequest(request: Request, path: string, send: AgentFetch): Promise<Response> {
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
      return Response.json({ error: "Invalid Agent response", code: "agent_bad_gateway" }, { status: 502 });
    }
    const outgoing = new Headers();
    const hopHeaders = new Set((upstream.headers.get("connection") ?? "").toLowerCase().split(",").map((name) => name.trim()));
    for (const name of RESPONSE_HEADERS) {
      const value = upstream.headers.get(name);
      if (value !== null && !hopHeaders.has(name)) outgoing.set(name, value);
    }
    // Reuse the fetch body: backpressure/cancellation stay native, without parsing SSE or buffering downloads.
    return new Response(upstream.body, { status: upstream.status, statusText: upstream.statusText, headers: outgoing });
  } catch {
    if (request.signal.aborted) return new Response(null, { status: 204 });
    // An interrupted POST may already have run. Never invent accepted:false or retry it here.
    return Response.json({ error: "Agent service unavailable", code: "agent_unavailable" }, { status: 503 });
  }
}
