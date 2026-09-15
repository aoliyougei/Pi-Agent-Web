export type SubagentScope = "builtin" | "global" | "workspace" | "project";
export type SubagentWritableScope = Extract<SubagentScope, "global" | "project">;

export interface SubagentProfile {
  name: string;
  displayName: string;
  description: string;
  systemPrompt: string;
  tools: string[];
  loadSkills: boolean;
  loadExtensions: boolean;
  model?: string;
  thinking?: "off" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max";
  maxTurns?: number;
  inheritContext: boolean;
  runInBackground: boolean;
  enabled: boolean;
  scope: SubagentScope;
  filePath?: string;
}
