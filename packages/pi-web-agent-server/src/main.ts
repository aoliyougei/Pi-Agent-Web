#!/usr/bin/env node
import { PROTOCOL_VERSION, REQUIRED_CAPABILITIES } from "@aoliyougei/pi-agent-contract";
import { loadToken } from "./config.js";
import { createAgentServer } from "./server.js";

const tokenPath = process.env.PI_AGENT_RPC_TOKEN_FILE ?? "/run/secrets/pi-agent-rpc-token";
const host = process.env.PI_AGENT_RPC_HOST ?? "0.0.0.0";
const port = Number(process.env.PI_AGENT_RPC_PORT ?? "8080");
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("Invalid RPC port");
const token = await loadToken(tokenPath, {
  uid: process.getuid?.() ?? -1,
  gids: process.getgroups?.() ?? [],
});
const app = createAgentServer({
  token,
  version: {
    protocolVersion: PROTOCOL_VERSION,
    serverVersion: "0.1.0",
    piVersion: "0.84.4",
    piRevision: "b79e4cc834970cca69daebffab7df1da7d1e52c4",
    capabilities: [...REQUIRED_CAPABILITIES],
  },
});
await app.listen(host, port);

for (const signal of ["SIGTERM", "SIGINT"] as const) {
  process.once(signal, async () => {
    app.beginShutdown();
    await app.close();
  });
}
