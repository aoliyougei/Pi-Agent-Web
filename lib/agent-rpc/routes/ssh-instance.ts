import { agentFetch } from "../index";
import { createRemoteSshRoutes } from "./ssh";

export const remoteSshRoutes = createRemoteSshRoutes(agentFetch);
