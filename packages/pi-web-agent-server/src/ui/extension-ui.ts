import type {
  ExtensionUiResponsePayload,
  OrdinaryExtensionUiRequest,
} from "@aoliyougei/pi-agent-contract";

const BLOCKING_METHODS = new Set(["select", "confirm", "input", "editor"]);

export function pendingOrdinaryExtensionUi(events: Iterable<{ type: string; [key: string]: unknown }>): OrdinaryExtensionUiRequest[] {
  return [...events].filter((event): event is OrdinaryExtensionUiRequest =>
    event.type === "extension_ui_request"
    && typeof event.id === "string"
    && typeof event.method === "string"
    && BLOCKING_METHODS.has(event.method));
}

export function isExtensionUiResponseFor(
  request: OrdinaryExtensionUiRequest,
  value: unknown,
): value is ExtensionUiResponsePayload {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const response = value as Record<string, unknown>;
  if (response.cancelled === true && Object.keys(response).length === 1) return true;
  if ((request.method === "select" || request.method === "input" || request.method === "editor")
    && typeof response.value === "string" && Object.keys(response).length === 1) return true;
  return request.method === "confirm"
    && typeof response.confirmed === "boolean"
    && Object.keys(response).length === 1;
}
