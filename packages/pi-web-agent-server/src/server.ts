import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import type { AgentVersion } from "@aoliyougei/pi-agent-contract";
import { routeRequest } from "./router.js";
import type { AgentRouteAdapter } from "./routes/agent.js";
import type { ModelAuthAdapter } from "./routes/auth.js";
import type { PushAdapter } from "./routes/push.js";
import type { ResourceAdapter } from "./routes/resources.js";
import { AgentEventChannels } from "./routes/events.js";
import { RequestDeduplicator } from "./runtime/request-dedup.js";

export interface AgentServer {
  listen(host: string, port: number): Promise<void>;
  address(): AddressInfo | string | null;
  beginShutdown(): void;
  close(): Promise<void>;
}

export function createAgentServer(options: {
  token: string;
  version: AgentVersion;
  agent?: AgentRouteAdapter;
  modelAuth?: ModelAuthAdapter;
  push?: PushAdapter;
  resources?: ResourceAdapter;
  eventBufferCapacity?: number;
}): AgentServer {
  const eventBufferCapacity = options.eventBufferCapacity ?? 1_000;
  if (!Number.isInteger(eventBufferCapacity) || eventBufferCapacity < 1 || eventBufferCapacity > 100_000) {
    throw new Error("Invalid event buffer capacity");
  }
  let ready = true;
  const dedup = new RequestDeduplicator();
  const events = new AgentEventChannels(eventBufferCapacity);
  const server: Server = createServer((request, response) => {
    void Promise.resolve(routeRequest(request, response, { ...options, dedup, events, ready: () => ready })).catch((error: unknown) => {
      if (response.headersSent) { response.destroy(); return; }
      if (error && typeof error === "object" && "code" in error && error.code === "session_locked") {
        response.writeHead(409, { "content-type": "application/json; charset=utf-8" });
        response.end(JSON.stringify({ error: { code: "session_locked", message: "Session is already owned by another CLI or RPC runtime", requestId: request.headers["x-request-id"]?.toString() ?? "unknown" } }));
        return;
      }
      response.writeHead(500, { "content-type": "application/json; charset=utf-8" });
      response.end(JSON.stringify({ error: { code: "internal_error", message: "Internal error", requestId: "unknown" } }));
    });
  });
  return {
    listen: (host, port) => new Promise((resolve, reject) => {
      server.once("error", reject);
      server.listen(port, host, () => {
        server.off("error", reject);
        resolve();
      });
    }),
    address: () => server.address(),
    beginShutdown: () => { ready = false; },
    close: () => new Promise((resolve, reject) => {
      events.close();
      if (!server.listening) return resolve();
      server.close((error) => error ? reject(error) : resolve());
    }),
  };
}
