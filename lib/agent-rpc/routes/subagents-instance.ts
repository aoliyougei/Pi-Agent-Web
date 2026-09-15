import { agentFetch } from "../index";
import { createRemoteSubagentRoutes } from "./subagents";

export const remoteSubagentRoutes = createRemoteSubagentRoutes(agentFetch);
