export interface AgentEventLike {
  type: string;
  [key: string]: unknown;
}

type ContentEvent = { contentIndex: number };
type PartialEvent = { partial?: unknown };
type ToolCall = { id: string; name: string; arguments: Record<string, unknown> };

export type ClientAssistantMessageEvent =
  | ({ type: "start" } & PartialEvent)
  | ({ type: "text_start" | "thinking_start" } & ContentEvent & PartialEvent)
  | ({ type: "text_delta" | "thinking_delta"; delta: string } & ContentEvent & PartialEvent)
  | ({ type: "text_end" | "thinking_end"; content: string } & ContentEvent & PartialEvent)
  | ({ type: "toolcall_start"; id?: string; toolName?: string } & ContentEvent & PartialEvent)
  | ({ type: "toolcall_delta"; id?: string; toolName?: string; delta: string } & ContentEvent & PartialEvent)
  | ({ type: "toolcall_end"; toolCall: ToolCall } & ContentEvent & PartialEvent)
  | { type: "done" | "error"; [key: string]: unknown };
