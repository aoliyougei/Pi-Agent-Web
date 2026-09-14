import { remoteResourceRoutes } from "@/lib/agent-rpc/routes/resources-instance";

export const dynamic = "force-dynamic";

export const GET = (request: Request) => remoteResourceRoutes.SUBAGENT_PROFILES(request);
export const PUT = (request: Request) => remoteResourceRoutes.SUBAGENT_PROFILES(request);
export const PATCH = (request: Request) => remoteResourceRoutes.SUBAGENT_PROFILES(request);
export const DELETE = (request: Request) => remoteResourceRoutes.SUBAGENT_PROFILES(request);
