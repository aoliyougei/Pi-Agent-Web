import { createAssistantMessageEventStream } from "@earendil-works/pi-ai";

export default function (pi: any) {
  pi.registerProvider("phase2", {
    api: "phase2-test",
    baseUrl: "http://127.0.0.1/unused",
    apiKey: "test",
    models: [{ id: "echo", name: "Phase 2 Echo", reasoning: true, input: ["text"], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 4096, maxTokens: 512 }],
    streamSimple(model: any, context: any, options: any) {
      const stream = createAssistantMessageEventStream();
      const text = context.messages.at(-1)?.content?.find?.((part: any) => part.type === "text")?.text ?? "ok";
      const message = { role: "assistant", content: [{ type: "text", text: `echo:${text}` }], api: model.api, provider: model.provider, model: model.id, usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } }, stopReason: "stop", timestamp: Date.now() };
      const emit = () => {        stream.push({ type: "start", partial: { ...message, content: [], stopReason: "pending" } });
        stream.push({ type: "text_start", contentIndex: 0, partial: { ...message, content: [{ type: "text", text: "" }], stopReason: "pending" } });
        stream.push({ type: "text_delta", contentIndex: 0, delta: message.content[0].text, partial: { ...message, stopReason: "pending" } });
        stream.push({ type: "text_end", contentIndex: 0, content: message.content[0].text, partial: { ...message, stopReason: "pending" } });
        stream.push({ type: "done", reason: "stop", message });
        stream.end();
      };
      if (text.startsWith("slow")) {
        const timer = setTimeout(emit, 1000);
        options?.signal?.addEventListener("abort", () => {
          clearTimeout(timer);
          stream.push({ type: "error", reason: "aborted", error: { ...message, content: [], stopReason: "aborted" } });
          stream.end();
        }, { once: true });
      } else queueMicrotask(emit);
      return stream;
    },
  });

  pi.registerCommand("phase2-dialogs", {
    description: "Phase 2 dialog transport acceptance",
    handler: async (_args: string, ctx: any) => {
      ctx.ui.setStatus("phase2", "running");
      ctx.ui.setWidget("phase2", ["widget"]);
      ctx.ui.setTitle("Phase 2");
      ctx.ui.setEditorText("seed");
      const selected = await ctx.ui.select("select", ["a", "b"]);
      const confirmed = await ctx.ui.confirm("confirm", "continue?");
      const input = await ctx.ui.input("input", "value");
      const edited = await ctx.ui.editor("editor", "text");
      ctx.ui.notify(`${selected}:${confirmed}:${input}:${edited}`, "info");
    },
  });

  pi.registerCommand("phase2-custom", {
    description: "Phase 2 custom terminal acceptance",
    handler: async (_args: string, ctx: any) => {
      const result = await ctx.ui.custom((_tui: any, _theme: any, _keys: any, done: (value: string) => void) => {
        const inputs: string[] = [];
        return {
          render: () => [inputs.length ? inputs.map((value) => JSON.stringify(value)).join("|") : "initial"],
          handleInput(data: string) { if (data === "\r") done(inputs.join(",")); else inputs.push(data); },
        };
      });
      ctx.ui.notify(`custom:${result}`, "info");
    },
  });
}
