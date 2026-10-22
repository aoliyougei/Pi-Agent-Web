"use client";
import { sessionFetch as fetch } from "@/lib/session-scope";
import { useEffect, useState } from "react";
import type { SshEnvironmentResponse } from "@/lib/middleware/ssh-remote-status/types";
export function useSshRemoteStatus(sessionId:string|undefined,refreshKey:unknown=0){const [result,setResult]=useState<SshEnvironmentResponse>({environment:null});useEffect(()=>{setResult({environment:null});if(!sessionId)return;const controller=new AbortController();fetch(`/api/sessions/${encodeURIComponent(sessionId)}/ssh-environment`,{signal:controller.signal}).then(async r=>r.ok?await r.json() as SshEnvironmentResponse:{environment:null}).then(v=>{if(!controller.signal.aborted)setResult(v)}).catch(e=>{if(!(e instanceof DOMException&&e.name==="AbortError"))setResult({environment:null})});return()=>controller.abort()},[sessionId,refreshKey]);return result;}
