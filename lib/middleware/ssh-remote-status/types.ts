export type SavedSshEnvironmentDto={mode:"ssh";stateVersion:1|2;target:string;port?:number;remoteCwd:string;remotePlatform:"unix"|"windows";remoteShell:"bash"|"zsh"|"sh"|"pwsh"|"powershell";requestedCwd?:string;configFile?:string};
export type SshEnvironmentWarning="unsupported-state-version"|"invalid-state";
export type SshEnvironmentResponse={environment:SavedSshEnvironmentDto|null;source?:"saved-session";warning?:SshEnvironmentWarning};
