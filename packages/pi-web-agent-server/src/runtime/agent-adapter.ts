import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import type { NewAgentRequest } from "@aoliyougei/pi-agent-contract";
import { resolveSessionPath } from "../dependencies/session-reader.js";
import type { AgentRouteAdapter } from "../routes/agent.js";
import {
  getCompletionNotificationSuppressedRpcSessionIds,
  getRpcSession,
  getRunningRpcSessionIds,
  setRpcSessionTools,
  startRpcSession,
} from "./session-runtime.js";

export function createAgentRouteAdapter(): AgentRouteAdapter {
  return {
    async open(id) {
      const existing = getRpcSession(id);
      if (existing?.isAlive()) return existing;
      const file = await resolveSessionPath(id);
      return file ? (await startRpcSession(id, file, undefined)).session : null;
    },
    async send(id, command) {
      const existing = getRpcSession(id);
      if (command.type === "set_tools") {
        const file = existing?.sessionFile || await resolveSessionPath(id) || undefined;
        if (!existing?.isAlive() && !file) return { found: false };
        const changed = await setRpcSessionTools(id, file, command.toolNames);
        return { found: true, data: { sessionId: changed.sessionId, recreated: changed.recreated } };
      }
      const runtime = existing?.isAlive()
        ? existing
        : await resolveSessionPath(id).then((file) => file ? startRpcSession(id, file, undefined).then(({ session }) => session) : null);
      return runtime ? { found: true, data: await runtime.send(command) } : { found: false };
    },
    async create(request: NewAgentRequest) {
      if (!existsSync(request.cwd)) throw new Error(`Directory does not exist: ${request.cwd}`);
      const started = await startRpcSession(`__new__${randomUUID()}`, "", request.cwd, request.options);
      return { id: started.realSessionId, runtime: started.session };
    },
    running: () => ({
      runningSessionIds: getRunningRpcSessionIds(),
      completionNotificationSuppressedSessionIds: getCompletionNotificationSuppressedRpcSessionIds(),
    }),
  };
}
