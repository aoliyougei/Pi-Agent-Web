import { BackendConfigError, listBackends, saveBackend, deleteBackend } from "@/lib/agent-rpc/backends";
import { readJsonBody } from "@/lib/agent-rpc/proxy";

export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "no-store" };

function failure(error: unknown): Response {
  return Response.json({ error: error instanceof BackendConfigError ? error.message : "Unable to access Web backend configuration" }, {
    status: error instanceof BackendConfigError ? (error.message === "Backend not found" ? 404 : 400) : 500, headers,
  });
}

export async function GET() {
  try { return Response.json({ backends: await listBackends() }, { headers }); }
  catch (error) { return failure(error); }
}

async function body(request: Request): Promise<unknown> {
  if (!request.body || request.headers.get("content-type")?.split(";", 1)[0].trim() !== "application/json") throw new BackendConfigError("JSON body required");
  const bytes = await readJsonBody(request);
  if (!bytes || bytes.byteLength > 16384) throw new BackendConfigError("Configuration body too large");
  try { return JSON.parse(new TextDecoder().decode(bytes)); }
  catch { throw new BackendConfigError("Invalid JSON body"); }
}

export async function POST(request: Request) {
  try { return Response.json({ backend: await saveBackend(await body(request)) }, { headers }); }
  catch (error) { return failure(error); }
}

export async function DELETE(request: Request) {
  try {
    const input = await body(request) as { id: string } | null;
    await deleteBackend(input?.id as string);
    return Response.json({ success: true }, { headers });
  } catch (error) { return failure(error); }
}
