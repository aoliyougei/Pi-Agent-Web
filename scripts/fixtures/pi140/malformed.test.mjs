import assert from "node:assert/strict";
import test from "node:test";
import { Agent } from "@earendil-works/pi-agent-core";
import { createAssistantMessageEventStream } from "@earendil-works/pi-ai";
import { normalizeToolCalls } from "../dist/dependencies/normalize.js";

test("Pi rejects malformed complete tool arguments without invoking the tool and preserves the client diagnostic", async () => {
  let executed = 0, requests = 0;
  const agent = new Agent({
    initialState: {
      model: { id: "local", name: "Local", provider: "test", api: "test", baseUrl: "http://unused", reasoning: false, input: ["text"], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 4096, maxTokens: 256 },
      tools: [{ name: "mutate", description: "Must not execute", parameters: { type: "object", properties: {} }, execute: async () => { executed++; return { content: [{ type: "text", text: "WRONG" }] }; } }],
    },
    streamFn(model) {
      const stream = createAssistantMessageEventStream();
      const first = requests++ === 0;
      const message = { role: "assistant", api: model.api, provider: model.provider, model: model.id, timestamp: Date.now(), stopReason: first ? "toolUse" : "stop", content: first ? [{ type: "toolCall", id: "bad", name: "mutate", arguments: {}, argumentsError: 'Invalid tool JSON: {"path":' }] : [{ type: "text", text: "recovered" }], usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } } };
      queueMicrotask(() => { stream.push({ type: "done", reason: message.stopReason, message }); stream.end(); });
      return stream;
    },
  });
  await agent.prompt("do not run malformed calls");
  assert.equal(executed, 0);
  assert.equal(requests, 2);
  const tool = agent.state.messages.find((message) => message.role === "toolResult");
  assert.equal(tool.isError, true);
  assert.match(JSON.stringify(tool.content), /Invalid tool JSON/);
  const assistant = agent.state.messages.find((message) => message.role === "assistant");
  assert.equal(normalizeToolCalls(assistant).content[0].argumentsError, 'Invalid tool JSON: {"path":');
});
