import { remoteModelsAuthRoutes } from "@/lib/agent-rpc/routes/models-auth-instance";
import { hasJsonContentType, isApiRequestAllowed } from "@/lib/request-security";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  if (!isApiRequestAllowed(request)) return Response.json({ ok: false, error: "Untrusted API request" }, { status: 403 });
  if (!hasJsonContentType(request)) return Response.json({ ok: false, error: "Content-Type must be application/json" }, { status: 415 });
  return remoteModelsAuthRoutes.TEST(request);
}
