import { NextResponse } from "next/server";
import { listBackends } from "@/lib/agent-rpc/backends";

export async function GET() {
  try {
    // An offline/deleted Agent must not hide the settings needed to reconnect.
    await listBackends();
    return NextResponse.json({ status: "ok" });
  } catch {
    return NextResponse.json({ status: "unavailable" }, { status: 503 });
  }
}
