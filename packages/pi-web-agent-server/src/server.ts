import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import type { AgentVersion } from "@aoliyougei/pi-agent-contract";
import { routeRequest } from "./router.js";

export interface AgentServer {
  listen(host: string, port: number): Promise<void>;
  address(): AddressInfo | string | null;
  beginShutdown(): void;
  close(): Promise<void>;
}

export function createAgentServer(options: { token: string; version: AgentVersion }): AgentServer {
  let ready = true;
  const server: Server = createServer((request, response) => {
    routeRequest(request, response, { ...options, ready: () => ready });
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
      if (!server.listening) return resolve();
      server.close((error) => error ? reject(error) : resolve());
    }),
  };
}
