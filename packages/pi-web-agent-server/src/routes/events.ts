import type { IncomingMessage, ServerResponse } from "node:http";
import { agentError, type AgentStreamEvent } from "@aoliyougei/pi-agent-contract";
import type { AgentRouteAdapter, AgentRouteRuntime } from "./agent.js";
import { toClientAgentEvent } from "../dependencies/agent-event-wire.js";
import { EventBuffer } from "../runtime/event-buffer.js";

const HEARTBEAT_MS = 30_000;

type EventRuntime = AgentRouteRuntime & {
  isStreaming?: boolean;
  onEvent(listener: (event: unknown) => void): () => void;
  currentFrames?(): unknown[];
  streamingMessage?: unknown;
};

type Writer = {
  send(event: AgentStreamEvent): void;
  data(payload: unknown): void;
  heartbeat(): void;
  close(): void;
};

class EventChannel {
  readonly buffer: EventBuffer;
  private readonly writers = new Set<Writer>();
  private readonly unsubscribe: () => void;

  constructor(readonly runtime: EventRuntime, capacity: number) {
    this.buffer = new EventBuffer(capacity);
    const initial = new Map<string, number>();
    for (const frame of runtime.currentFrames?.() ?? []) {
      const key = JSON.stringify(frame);
      initial.set(key, (initial.get(key) ?? 0) + 1);
    }
    this.unsubscribe = runtime.onEvent((payload) => {
      if (!payload || typeof payload !== "object") return;
      const projected = toClientAgentEvent(payload as { type: string; [key: string]: unknown });
      if (!projected) return;
      const key = JSON.stringify(projected);
      const remaining = initial.get(key) ?? 0;
      if (remaining > 0) {
        if (remaining === 1) initial.delete(key);
        else initial.set(key, remaining - 1);
        return;
      }
      const event = this.buffer.append(projected);
      for (const writer of this.writers) writer.send(event);
    });
  }

  add(writer: Writer): () => void {
    this.writers.add(writer);
    return () => this.writers.delete(writer);
  }

  close(): void {
    this.unsubscribe();
    for (const writer of this.writers) writer.close();
    this.writers.clear();
  }
}

export class AgentEventChannels {
  private readonly channels = new Map<string, EventChannel>();

  constructor(private readonly capacity: number) {}

  get(id: string, runtime: EventRuntime): EventChannel {
    const existing = this.channels.get(id);
    if (existing?.runtime === runtime) return existing;
    existing?.close();
    const channel = new EventChannel(runtime, this.capacity);
    this.channels.set(id, channel);
    return channel;
  }

  close(): void {
    for (const channel of this.channels.values()) channel.close();
    this.channels.clear();
  }
}

function writer(response: ServerResponse): Writer {
  let closed = false;
  const write = (text: string) => {
    if (closed || response.destroyed || response.writableEnded) return;
    if (!response.write(text)) {
      closed = true;
      response.destroy();
    }
  };
  return {
    send: (event) => write(`id: ${event.id}\ndata: ${event.data}\n\n`),
    data: (payload) => write(`data: ${JSON.stringify(payload)}\n\n`),
    heartbeat: () => write(":\n\n"),
    close() {
      if (closed) return;
      closed = true;
      if (!response.writableEnded) response.end();
    },
  };
}

export async function routeAgentEvents(
  request: IncomingMessage,
  response: ServerResponse,
  path: string,
  requestId: string,
  agent: AgentRouteAdapter,
  channels: AgentEventChannels,
): Promise<boolean> {
  const match = /^\/internal\/v1\/api\/agent\/([^/]+)\/events$/.exec(path);
  if (request.method !== "GET" || !match) return false;
  let id: string;
  try { id = decodeURIComponent(match[1]); } catch { id = ""; }
  if (!/^[A-Za-z0-9](?:[A-Za-z0-9._-]*[A-Za-z0-9])?$/.test(id)) {
    response.writeHead(400, { "content-type": "application/json; charset=utf-8" });
    response.end(JSON.stringify(agentError("invalid_request", "Invalid session id", requestId)));
    return true;
  }

  const runtime = await agent.open(id) as EventRuntime | null;
  if (!runtime || typeof runtime.onEvent !== "function") {
    response.writeHead(404, { "content-type": "application/json; charset=utf-8" });
    response.end(JSON.stringify(agentError("session_not_found", "Session not found", requestId)));
    return true;
  }
  const channel = channels.get(id, runtime);
  const replay = channel.buffer.replayAfter(request.headers["last-event-id"]?.toString());
  if (replay.resyncRequired) {
    response.writeHead(409, { "content-type": "application/json; charset=utf-8" });
    response.end(JSON.stringify(agentError("resync_required", "Event cursor is no longer available", requestId)));
    return true;
  }

  response.writeHead(200, {
    "content-type": "text/event-stream; charset=utf-8",
    "cache-control": "no-cache, no-transform",
    connection: "keep-alive",
    "x-accel-buffering": "no",
  });
  const streamWriter = writer(response);
  const remove = channel.add(streamWriter);
  let heartbeat: ReturnType<typeof setInterval> | undefined;
  const cleanup = () => {
    if (heartbeat) clearInterval(heartbeat);
    streamWriter.close();
    remove();
  };
  response.once("close", cleanup);

  streamWriter.heartbeat();
  streamWriter.data({ type: "connected", sessionId: id, isStreaming: runtime.isStreaming ?? false });
  if (request.headers["last-event-id"] === undefined) {
    for (const frame of runtime.currentFrames?.() ?? []) streamWriter.data(frame);
    if (runtime.streamingMessage !== undefined && runtime.streamingMessage !== null) {
      streamWriter.data({ type: "message_start", message: runtime.streamingMessage });
    }
  }
  for (const event of replay.events) streamWriter.send(event);
  if (request.headers["last-event-id"] !== undefined) {
    for (const frame of runtime.currentFrames?.() ?? []) {
      if (frame && typeof frame === "object" && "method" in frame && frame.method === "custom") streamWriter.data(frame);
    }
  }
  if (!response.destroyed) heartbeat = setInterval(() => streamWriter.heartbeat(), HEARTBEAT_MS);
  return true;
}
