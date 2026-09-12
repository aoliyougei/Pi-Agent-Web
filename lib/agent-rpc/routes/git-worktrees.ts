import { proxyJson, type AgentFetch } from "../proxy";
import { browserResponse } from "./agent";

const query = (request: Request) => new URL(request.url).search;

export function createRemoteGitWorktreeRoutes(send: AgentFetch) {
  const proxy = async (request: Request, path: string) => browserResponse(await proxyJson(request, `${path}${query(request)}`, send));
  return {
    STATUS: (request: Request) => proxy(request, "/internal/v1/api/git/status"),
    DIFF: (request: Request) => proxy(request, "/internal/v1/api/git/diff"),
    WORKTREES: (request: Request) => proxy(request, "/internal/v1/api/worktrees"),
  };
}
