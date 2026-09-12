import { remoteFileRoutes } from "@/lib/agent-rpc/routes/files-instance";
import { isApiRequestAllowed } from "@/lib/request-security";

type Context = { params: Promise<{ path: string[] }> };

export const GET = remoteFileRoutes.FILES;

export function POST(request: Request, context: Context) {
  if (!isApiRequestAllowed(request)) {
    return Response.json({ error: "Untrusted API request" }, { status: 403 });
  }
  return remoteFileRoutes.FILES(request, context);
}
