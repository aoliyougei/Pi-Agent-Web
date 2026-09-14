import { remoteResourceRoutes } from "@/lib/agent-rpc/routes/resources-instance";

export const dynamic = "force-dynamic";

export const POST = (request: Request) => remoteResourceRoutes.SKILL_CHECK(request);
