import { NextResponse } from "next/server";
import { mkdirSync } from "fs";
import { allowFileRoot } from "@/lib/file-access";
import { defaultCwdPath } from "@/lib/middleware/ssh-remote-status/default-cwd";

// POST /api/default-cwd
// Creates <PI_WEB_DEFAULT_CWD_ROOT>/pi-cwd-<YYYYMMDD> and returns the path.
export async function POST() {
  try {
    const dir = defaultCwdPath(new Date(), process.env.PI_WEB_DEFAULT_CWD_ROOT);
    mkdirSync(dir, { recursive: true });
    allowFileRoot(dir);
    return NextResponse.json({ cwd: dir });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
