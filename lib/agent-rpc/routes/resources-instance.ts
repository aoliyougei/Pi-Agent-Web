import { agentFetch } from "../index";
import { createRemoteResourceRoutes } from "./resources";

export const remoteResourceRoutes = createRemoteResourceRoutes(agentFetch);
