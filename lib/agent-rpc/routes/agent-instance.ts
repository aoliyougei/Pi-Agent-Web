import { agentFetch } from "../index";
import { createRemoteAgentRoutes } from "./agent";

export const remoteAgentRoutes = createRemoteAgentRoutes(agentFetch);
