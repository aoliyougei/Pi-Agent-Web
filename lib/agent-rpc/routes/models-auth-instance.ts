import { agentFetch } from "../index";
import { createRemoteModelsAuthRoutes } from "./models-auth";

export const remoteModelsAuthRoutes = createRemoteModelsAuthRoutes(agentFetch);
