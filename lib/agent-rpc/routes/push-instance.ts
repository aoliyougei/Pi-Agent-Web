import { agentFetch } from "../index";
import { createRemotePushRoutes } from "./push";

export const remotePushRoutes = createRemotePushRoutes(agentFetch);
