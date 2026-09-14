import { remoteResourceRoutes } from "@/lib/agent-rpc/routes/resources-instance";

export const dynamic = "force-dynamic";

export const GET = (request: Request) => remoteResourceRoutes.PROJECT_TRUST(request);
export const POST = (request: Request) => remoteResourceRoutes.PROJECT_TRUST(request);
