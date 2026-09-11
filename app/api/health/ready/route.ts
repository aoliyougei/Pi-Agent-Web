import { NextResponse } from "next/server";
import { agentFetch, checkAgentCompatibility } from "@/lib/agent-rpc";

export async function GET() {
  try {
    const response = await agentFetch("/internal/v1/version");
    if (!response.ok) throw new Error();
    checkAgentCompatibility(await response.json());
    return NextResponse.json({ status: "ok" });
  } catch {
    return NextResponse.json({ status: "unavailable" }, { status: 503 });
  }
}
