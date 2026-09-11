import { NextResponse } from "next/server";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { getRpcSession } from "@/lib/rpc-manager";
import { resolveSessionPath } from "@/lib/session-reader";
import { parseSavedSshEnvironment } from "@/lib/middleware/ssh-remote-status/ssh-environment";
export async function GET(_req:Request,{params}:{params:Promise<{id:string}>}){const {id}=await params;try{const rpc=getRpcSession(id);const filePath=rpc?.isAlive()?null:await resolveSessionPath(id);if(!rpc?.isAlive()&&!filePath)return NextResponse.json({error:"Session not found"},{status:404});const manager=rpc?.isAlive()?rpc.inner.sessionManager:SessionManager.open(filePath!);return NextResponse.json({...parseSavedSshEnvironment(manager.getBranch()),source:"saved-session"});}catch{return NextResponse.json({error:"Unable to read SSH environment"},{status:500});}}
