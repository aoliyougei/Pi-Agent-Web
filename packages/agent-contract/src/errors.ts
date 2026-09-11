export type AgentErrorCode =
  | "unauthorized"
  | "protocol_mismatch"
  | "invalid_request"
  | "request_too_large"
  | "session_not_found"
  | "session_locked"
  | "request_id_conflict"
  | "request_settled"
  | "agent_unavailable"
  | "agent_timeout"
  | "resync_required"
  | "internal_error";

export interface AgentErrorBody {
  error: {
    code: AgentErrorCode;
    message: string;
    requestId: string;
  };
}

export function agentError(code: AgentErrorCode, message: string, requestId: string): AgentErrorBody {
  return { error: { code, message, requestId } };
}
