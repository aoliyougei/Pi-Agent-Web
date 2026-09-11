import { SessionManager } from "@earendil-works/pi-coding-agent";
import { getRpcSession } from "@/lib/rpc-manager";
import type { SessionInfo } from "@/lib/types";
import { workspaceIdentityFromEnvironment } from "@/lib/middleware/ssh-remote-status/workspace-model";
import { parseSavedSshEnvironment } from "./ssh-environment";

export async function attachSessionWorkspaceIdentities(sessions: SessionInfo[]): Promise<SessionInfo[]> {
  return Promise.all(sessions.map(async (session) => {
    try {
      const rpc = getRpcSession(session.id);
      const manager = rpc?.isAlive() ? rpc.inner.sessionManager : SessionManager.open(session.path);
      return { ...session, ...workspaceIdentityFromEnvironment(session, parseSavedSshEnvironment(manager.getBranch())) };
    } catch {
      return { ...session, ...workspaceIdentityFromEnvironment(session, { environment: null }) };
    }
  }));
}
