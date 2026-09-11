import { validateAgentImages } from "./images.js";

export const THINKING_LEVELS = ["off", "minimal", "low", "medium", "high", "xhigh", "max"] as const;
export type ThinkingLevel = typeof THINKING_LEVELS[number];

export interface AgentImage {
  type: "image";
  data: string;
  mimeType: string;
}

export type AgentCommand =
  | { type: "prompt"; message: string; images?: AgentImage[]; streamingBehavior?: "steer" | "followUp" }
  | { type: "abort" | "get_state" | "get_session_stats" | "get_last_assistant_text" | "clear_queue" | "get_tools" | "get_commands" | "reload" | "abort_compaction" | "abort_bash" }
  | { type: "set_model"; provider: string; modelId: string }
  | { type: "fork"; entryId: string }
  | { type: "clone"; leafId?: string }
  | { type: "navigate_tree"; targetId: string }
  | { type: "set_thinking_level"; level: ThinkingLevel }
  | { type: "compact"; customInstructions?: string }
  | { type: "set_session_name"; name: string }
  | { type: "set_auto_compaction" | "set_auto_retry"; enabled: boolean }
  | { type: "steer" | "follow_up"; message: string; images?: AgentImage[] }
  | { type: "set_tools"; toolNames: string[] }
  | { type: "extension_ui_response"; id: string; value: string }
  | { type: "extension_ui_response"; id: string; confirmed: boolean }
  | { type: "extension_ui_response"; id: string; cancelled: true }
  | { type: "extension_ui_input"; id: string; data: string }
  | { type: "bash"; command: string; excludeFromContext?: boolean };

export interface NewAgentRequest {
  cwd: string;
  command: AgentCommand | { type: "ensure_session" };
  options: {
    toolNames?: string[];
    initialModel?: { provider: string; modelId: string };
    thinkingLevel?: ThinkingLevel;
  };
}

const NO_FIELDS = new Set([
  "abort", "get_state", "get_session_stats", "get_last_assistant_text", "clear_queue",
  "get_tools", "get_commands", "reload", "abort_compaction", "abort_bash",
]);
const THINKING = new Set<string>(THINKING_LEVELS);

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid command object");
  rejectPrototypeKeys(value);
  return value as Record<string, unknown>;
}

function rejectPrototypeKeys(value: unknown): void {
  if (!value || typeof value !== "object") return;
  for (const key of Object.keys(value)) {
    if (key === "__proto__" || key === "prototype" || key === "constructor") throw new Error(`Forbidden key: ${key}`);
    rejectPrototypeKeys((value as Record<string, unknown>)[key]);
  }
}

function string(value: unknown, name: string): string {
  if (typeof value !== "string") throw new Error(`${name} must be a string`);
  return value;
}

function optionalString(value: unknown, name: string): string | undefined {
  return value === undefined ? undefined : string(value, name);
}

function boolean(value: unknown, name: string): boolean {
  if (typeof value !== "boolean") throw new Error(`${name} must be a boolean`);
  return value;
}

function strings(value: unknown, name: string): string[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) throw new Error(`${name} must be an array of strings`);
  return [...value];
}

function images(value: unknown): AgentImage[] | undefined {
  const error = validateAgentImages(value);
  if (error) throw new Error(error);
  return value === undefined ? undefined : value as AgentImage[];
}

export function parseAgentCommand(value: unknown): AgentCommand {
  const input = record(value);
  const type = string(input.type, "type");
  if (NO_FIELDS.has(type)) return { type } as AgentCommand;
  switch (type) {
    case "prompt": {
      const streamingBehavior = optionalString(input.streamingBehavior, "streamingBehavior");
      if (streamingBehavior !== undefined && streamingBehavior !== "steer" && streamingBehavior !== "followUp") throw new Error("Invalid streamingBehavior");
      const parsedImages = images(input.images);
      return { type, message: string(input.message, "message"), ...(parsedImages ? { images: parsedImages } : {}), ...(streamingBehavior ? { streamingBehavior } : {}) };
    }
    case "set_model": return { type, provider: string(input.provider, "provider"), modelId: string(input.modelId, "modelId") };
    case "fork": return { type, entryId: string(input.entryId, "entryId") };
    case "clone": return { type, ...(input.leafId === undefined ? {} : { leafId: string(input.leafId, "leafId") }) };
    case "navigate_tree": return { type, targetId: string(input.targetId, "targetId") };
    case "set_thinking_level": {
      const level = string(input.level, "level");
      if (!THINKING.has(level)) throw new Error("Invalid thinking level");
      return { type, level: level as ThinkingLevel };
    }
    case "compact": return { type, ...(input.customInstructions === undefined ? {} : { customInstructions: string(input.customInstructions, "customInstructions") }) };
    case "set_session_name": return { type, name: string(input.name, "name") };
    case "set_auto_compaction":
    case "set_auto_retry": return { type, enabled: boolean(input.enabled, "enabled") };
    case "steer":
    case "follow_up": {
      const parsedImages = images(input.images);
      return { type, message: string(input.message, "message"), ...(parsedImages ? { images: parsedImages } : {}) };
    }
    case "set_tools": return { type, toolNames: strings(input.toolNames, "toolNames") };
    case "extension_ui_response": {
      const id = string(input.id, "id");
      if (typeof input.value === "string") return { type, id, value: input.value };
      if (typeof input.confirmed === "boolean") return { type, id, confirmed: input.confirmed };
      if (input.cancelled === true) return { type, id, cancelled: true };
      throw new Error("Invalid extension UI response");
    }
    case "extension_ui_input": return { type, id: string(input.id, "id"), data: string(input.data, "data") };
    case "bash": return { type, command: string(input.command, "command"), ...(input.excludeFromContext === undefined ? {} : { excludeFromContext: boolean(input.excludeFromContext, "excludeFromContext") }) };
    default: throw new Error(`Unsupported command: ${type}`);
  }
}

export function parseNewAgentRequest(value: unknown): NewAgentRequest {
  const input = record(value);
  const cwd = string(input.cwd, "cwd");
  const provider = optionalString(input.provider, "provider");
  const modelId = optionalString(input.modelId, "modelId");
  if ((provider === undefined) !== (modelId === undefined)) throw new Error("provider and modelId must be provided together");
  const toolNames = input.toolNames === undefined ? undefined : strings(input.toolNames, "toolNames");
  const thinking = optionalString(input.thinkingLevel, "thinkingLevel");
  if (thinking !== undefined && !THINKING.has(thinking)) throw new Error("Invalid thinking level");
  const { cwd: _cwd, provider: _provider, modelId: _modelId, toolNames: _tools, thinkingLevel: _thinking, ...rawCommand } = input;
  const command = rawCommand.type === "ensure_session" ? { type: "ensure_session" as const } : parseAgentCommand(rawCommand);
  return {
    cwd,
    command,
    options: {
      ...(toolNames ? { toolNames } : {}),
      ...(provider && modelId ? { initialModel: { provider, modelId } } : {}),
      ...(thinking ? { thinkingLevel: thinking as ThinkingLevel } : {}),
    },
  };
}
