export interface SubagentToolDetails {
  kind: "pi-web-subagent";
  sessionId: string;
  profile: string;
  description: string;
  status: "starting" | "running" | "completed" | "failed" | "aborted" | "interrupted";
  runInBackground: boolean;
  createdAt: string;
  completedAt?: string;
  error?: string;
}
