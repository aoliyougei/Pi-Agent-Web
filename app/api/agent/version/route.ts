import { agentFetch } from "@/lib/agent-rpc";
import { createAgentVersionRoute } from "@/lib/agent-rpc/version-route";

export const GET = createAgentVersionRoute(agentFetch);
