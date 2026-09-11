import { loadToken } from "../packages/pi-web-agent-server/dist/config.js";

await loadToken(process.env.PI_AGENT_RPC_TOKEN_FILE ?? "/run/secrets/pi-agent-rpc-token", {
  uid: process.getuid?.() ?? -1,
  gids: process.getgroups?.() ?? [],
});
