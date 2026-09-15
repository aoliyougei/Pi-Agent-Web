import path from "node:path";
const MAX_REMOTE_PATH_CHARS=4096;
const invalid=(value:string)=>value.length>MAX_REMOTE_PATH_CHARS||/[\0\r\n]/.test(value);
export function resolveRemotePath({platform,root,input}:{platform:"unix"|"windows";root:string;input?:string}){if(invalid(root)||(input!==undefined&&invalid(input)))throw new Error("Remote path is invalid");const api=platform==="windows"?path.win32:path.posix;const base=api.resolve(root);if(!input||input===".")return base;if(api.isAbsolute(input))throw new Error("Remote path must be relative to the workspace");const value=api.resolve(base,input);const relative=api.relative(base,value);if(relative===".."||relative.startsWith(`..${api.sep}`)||api.isAbsolute(relative))throw new Error("Remote path escapes the workspace");return value;}
