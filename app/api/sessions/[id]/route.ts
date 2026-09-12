import { remoteSessionRoutes } from "@/lib/agent-rpc/routes/session-instance";

export const GET = remoteSessionRoutes.DETAIL;
export const PATCH = remoteSessionRoutes.MUTATE;
export const DELETE = remoteSessionRoutes.MUTATE;
