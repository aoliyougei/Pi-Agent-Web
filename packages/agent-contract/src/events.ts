export interface AgentStreamEvent {
  id: string;
  data: string;
}

export interface ConnectedAgentEvent {
  type: "connected";
  sessionId: string;
  isStreaming: boolean;
}

export interface CustomUiFrame {
  type: "extension_ui_request";
  method: "custom";
  id: string;
  revision: number;
  lines: string[];
  closed: boolean;
}

export interface ResyncRequiredAgentEvent {
  type: "resync_required";
}

export type OrdinaryExtensionUiRequest =
  | { type: "extension_ui_request"; id: string; method: "select"; title: string; options: string[]; timeout?: number; expiresAt?: number }
  | { type: "extension_ui_request"; id: string; method: "confirm"; title: string; message: string; timeout?: number; expiresAt?: number }
  | { type: "extension_ui_request"; id: string; method: "input"; title: string; placeholder?: string; timeout?: number; expiresAt?: number }
  | { type: "extension_ui_request"; id: string; method: "editor"; title: string; prefill?: string; timeout?: number; expiresAt?: number };

export type ExtensionUiResponsePayload =
  | { value: string }
  | { confirmed: boolean }
  | { cancelled: true };
