import { proxyJson, type AgentFetch } from "../proxy";
import { proxyStream } from "../stream-proxy";
import { browserResponse } from "./agent";

type SessionContext = { params: Promise<{ id: string }> };
type EntryContext = { params: Promise<{ id: string; entryId: string }> };
const ROOT = "/internal/v1/api/sessions";
const ID = /^[A-Za-z0-9](?:[A-Za-z0-9._-]*[A-Za-z0-9])?$/;
const EXPORT_HEADERS = ["content-type", "content-disposition", "cache-control", "content-security-policy", "x-content-type-options", "x-frame-options", "x-request-id"];
const IMAGE_HEADERS = ["content-type", "content-length", "cache-control", "x-content-type-options", "x-request-id"];

function invalid(): Response {
  return Response.json({ error: "Invalid session id", code: "invalid_request" }, { status: 400 });
}

function query(request: Request): string {
  return new URL(request.url).search;
}

export function createRemoteSessionRoutes(send: AgentFetch) {
  const session = async (request: Request, context: SessionContext, suffix = "", streamHeaders?: readonly string[]) => {
    const { id } = await context.params;
    if (!ID.test(id)) return invalid();
    const path = `${ROOT}/${encodeURIComponent(id)}${suffix}${query(request)}`;
    return browserResponse(streamHeaders
      ? await proxyStream(request, path, send, streamHeaders)
      : await proxyJson(request, path, send));
  };
  const entry = async (request: Request, context: EntryContext, suffix: string, streamHeaders?: readonly string[]) => {
    const { id, entryId } = await context.params;
    if (!ID.test(id) || !ID.test(entryId)) return invalid();
    const path = `${ROOT}/${encodeURIComponent(id)}/entries/${encodeURIComponent(entryId)}/${suffix}${query(request)}`;
    return browserResponse(streamHeaders
      ? await proxyStream(request, path, send, streamHeaders)
      : await proxyJson(request, path, send));
  };
  return {
    LIST: async (request: Request) => browserResponse(await proxyJson(request, `${ROOT}${query(request)}`, send)),
    DETAIL: (request: Request, context: SessionContext) => session(request, context),
    MUTATE: (request: Request, context: SessionContext) => session(request, context),
    CONTEXT: (request: Request, context: SessionContext) => session(request, context, "/context"),
    STATE: (request: Request, context: SessionContext) => session(request, context, "/state"),
    AUTO_NAME: (request: Request, context: SessionContext) => session(request, context, "/auto-name"),
    EXPORT: (request: Request, context: SessionContext) => session(request, context, "/export", EXPORT_HEADERS),
    THINKING: (request: Request, context: EntryContext) => entry(request, context, "thinking"),
    TOOL_RESULT_IMAGE: (request: Request, context: EntryContext) => entry(request, context, "tool-result-image", IMAGE_HEADERS),
  };
}
