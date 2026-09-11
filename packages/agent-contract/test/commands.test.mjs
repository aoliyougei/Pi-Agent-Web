import assert from "node:assert/strict";
import test from "node:test";
import { parseAgentCommand, parseNewAgentRequest } from "../dist/commands.js";

const validCommands = [
  { type: "prompt", message: "hello" },
  { type: "abort" },
  { type: "get_state" },
  { type: "set_model", provider: "p", modelId: "m" },
  { type: "fork", entryId: "e" },
  { type: "clone" },
  { type: "navigate_tree", targetId: "e" },
  { type: "set_thinking_level", level: "high" },
  { type: "compact", customInstructions: "short" },
  { type: "set_session_name", name: "name" },
  { type: "get_session_stats" },
  { type: "get_last_assistant_text" },
  { type: "set_auto_compaction", enabled: true },
  { type: "clear_queue" },
  { type: "steer", message: "now" },
  { type: "follow_up", message: "next" },
  { type: "get_tools" },
  { type: "get_commands" },
  { type: "set_tools", toolNames: ["read", "bash"] },
  { type: "reload" },
  { type: "abort_compaction" },
  { type: "extension_ui_response", id: "u", confirmed: true },
  { type: "extension_ui_input", id: "u", data: "x" },
  { type: "set_auto_retry", enabled: false },
  { type: "bash", command: "pwd", excludeFromContext: true },
  { type: "abort_bash" },
];

test("accepts every current Agent command discriminant", () => {
  for (const command of validCommands) assert.deepEqual(parseAgentCommand(command), command);
});

test("rejects unknown commands, missing fields, invalid images, and prototype keys", () => {
  const invalid = [
    null,
    [],
    {},
    { type: "future_command" },
    { type: "prompt" },
    { type: "set_model", provider: "p" },
    { type: "set_auto_retry", enabled: "yes" },
    { type: "set_tools", toolNames: ["read", 7] },
    { type: "prompt", message: "x", images: [{ type: "image", mimeType: "image/png", data: "%%%=" }] },
    JSON.parse('{"type":"abort","__proto__":{"polluted":true}}'),
  ];
  for (const command of invalid) assert.throws(() => parseAgentCommand(command), /Invalid|must|required|Unsupported|forbidden/i);
});

test("parses new-session startup fields separately from its command", () => {
  assert.deepEqual(parseNewAgentRequest({
    cwd: "/work",
    type: "prompt",
    message: "hello",
    provider: "openai",
    modelId: "gpt",
    toolNames: ["read"],
    thinkingLevel: "medium",
  }), {
    cwd: "/work",
    command: { type: "prompt", message: "hello" },
    options: {
      initialModel: { provider: "openai", modelId: "gpt" },
      toolNames: ["read"],
      thinkingLevel: "medium",
    },
  });
  assert.deepEqual(parseNewAgentRequest({ cwd: "/work", type: "ensure_session" }), {
    cwd: "/work",
    command: { type: "ensure_session" },
    options: {},
  });
  assert.throws(() => parseNewAgentRequest({ cwd: "/work", type: "prompt", message: "x", provider: "p" }), /together/i);
});
