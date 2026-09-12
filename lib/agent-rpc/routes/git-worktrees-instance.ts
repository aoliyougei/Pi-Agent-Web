import { agentFetch } from "../index";
import { createRemoteGitWorktreeRoutes } from "./git-worktrees";

export const remoteGitWorktreeRoutes = createRemoteGitWorktreeRoutes(agentFetch);
