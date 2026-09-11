export interface AgentStreamEvent {
  id: string;
  data: string;
}

export interface ConnectedAgentEvent {
  type: "connected";
  sessionId: string;
  isStreaming: boolean;
}

export interface ResyncRequiredAgentEvent {
  type: "resync_required";
}
