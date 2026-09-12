import { agentFetch } from "../index";
import { createRemoteFileRoutes } from "./files";

export const remoteFileRoutes = createRemoteFileRoutes(agentFetch);
