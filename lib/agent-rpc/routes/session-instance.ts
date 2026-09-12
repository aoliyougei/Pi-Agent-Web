import { agentFetch } from "../index";
import { createRemoteSessionRoutes } from "./sessions";

export const remoteSessionRoutes = createRemoteSessionRoutes(agentFetch);
