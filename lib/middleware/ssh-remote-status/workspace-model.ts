import type { SavedSshEnvironmentDto, SshEnvironmentResponse } from "./types";

export interface WorkspaceSessionLike {
  cwd: string;
  projectRoot?: string | null;
  projectKey?: string | null;
}

export type WorkspaceIdentity = {
  workspaceKind: "local" | "ssh";
  workspaceKey: string;
  workspaceLabel: string;
};

function localIdentity(session: WorkspaceSessionLike): WorkspaceIdentity {
  const key = session.projectKey ?? session.projectRoot ?? session.cwd;
  return { workspaceKind: "local", workspaceKey: key, workspaceLabel: session.projectRoot ?? session.cwd };
}

function sshKey(environment: SavedSshEnvironmentDto): string {
  return `ssh:${environment.target}:${environment.port ?? 22}:${environment.remoteCwd}`;
}

export function workspaceIdentityFromEnvironment(
  session: WorkspaceSessionLike,
  response: SshEnvironmentResponse,
): WorkspaceIdentity {
  const ssh = response.environment;
  if (!ssh) return localIdentity(session);
  const endpoint = `${ssh.target}${ssh.port && ssh.port !== 22 ? `:${ssh.port}` : ""}`;
  return {
    workspaceKind: "ssh",
    workspaceKey: sshKey(ssh),
    workspaceLabel: `${endpoint}:${ssh.remoteCwd}`,
  };
}
