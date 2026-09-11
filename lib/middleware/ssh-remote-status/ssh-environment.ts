import { win32 } from "node:path"; import type {SavedSshEnvironmentDto,SshEnvironmentResponse} from "@/lib/middleware/ssh-remote-status/types";
const SSH="pi-ssh-remote-state", LOCAL="pi-ssh-local-state", MAX=4096;
const record=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==="object"&&!Array.isArray(v);
const safe=(v:unknown,optional=false):v is string=>optional&&v===undefined||typeof v==="string"&&v.length>0&&v.length<=MAX&&!/[\0\r\n]/.test(v);
const target=(v:unknown):v is string=>safe(v)&&!v.startsWith("-")&&!/\s/.test(v);
const port=(v:unknown)=>v===undefined||typeof v==="number"&&Number.isInteger(v)&&v>=1&&v<=65535;
const unix=(v:unknown):v is string=>safe(v)&&v.startsWith("/");
const windows=(v:unknown):v is string=>safe(v)&&(/^[A-Za-z]:[\\/]/.test(v)||/^\\\\[^\\]/.test(v))&&win32.isAbsolute(v);
function parse(data:unknown):SavedSshEnvironmentDto|undefined{
 if(!record(data)||!target(data.target)||!port(data.port)||!safe(data.requestedCwd,true)||!safe(data.configFile,true))return;
 if(data.version===1){if(!unix(data.remoteCwd)||!unix(data.remoteHome))return;return {mode:"ssh",stateVersion:1,target:data.target, ...(data.port===undefined?{}:{port:data.port as number}),remoteCwd:data.remoteCwd,remotePlatform:"unix",remoteShell:"bash",...(data.requestedCwd===undefined?{}:{requestedCwd:data.requestedCwd as string}),...(data.configFile===undefined?{}:{configFile:data.configFile as string})};}
 if(data.version!==2)return;
 const platform=data.remotePlatform,shell=data.remoteShell; if(platform!=="unix"&&platform!=="windows")return;
 if(platform==="unix"&&(!["bash","zsh","sh"].includes(String(shell))||!unix(data.remoteCwd)||!unix(data.remoteHome)))return;
 if(platform==="windows"&&(!["pwsh","powershell"].includes(String(shell))||!windows(data.remoteCwd)||!windows(data.remoteHome)))return;
 return {mode:"ssh",stateVersion:2,target:data.target,...(data.port===undefined?{}:{port:data.port as number}),remoteCwd:data.remoteCwd as string,remotePlatform:platform,remoteShell:shell as SavedSshEnvironmentDto["remoteShell"],...(data.requestedCwd===undefined?{}:{requestedCwd:data.requestedCwd as string}),...(data.configFile===undefined?{}:{configFile:data.configFile as string})};
}
export function parseSavedSshEnvironment(entries:readonly unknown[]):SshEnvironmentResponse{
 for(let i=entries.length-1;i>=0;i--){const e=entries[i];if(!record(e)||e.type!=="custom"||(e.customType!==SSH&&e.customType!==LOCAL))continue;if(e.customType===LOCAL)return record(e.data)&&e.data.version===1?{environment:null}:{environment:null,warning:e.data&&record(e.data)&&typeof e.data.version==="number"?"unsupported-state-version":"invalid-state"};if(!record(e.data))return {environment:null,warning:"invalid-state"};if(e.data.version!==1&&e.data.version!==2)return {environment:null,warning:"unsupported-state-version"};const environment=parse(e.data);return environment?{environment}:{environment:null,warning:"invalid-state"};}return {environment:null};
}
