# Phase 2 Task 9 — inactive Agent BFF adapters

Status: **in progress**, not ready to activate public routes.

## Completed transport checkpoint

- [x] `lib/agent-rpc/proxy.ts`: single-attempt native fetch stream forwarding for JSON, SSE and downloads; no whole-body buffering or SSE reserialization.
- [x] `lib/agent-rpc/routes/agent.ts`: inactive new/running/state/command/events/bash-output path adapters, using an explicitly supplied Agent fetch client.
- [x] Request header allowlist keeps browser credentials/forwarded identity out; the existing client injects the service credential.
- [x] Response allowlist strips cookies, redirects and hop-by-hop headers. Redirect following is disabled. No upstream URL/token in transport errors.
- [x] Exact command bytes, status, SSE IDs/heartbeats, Last-Event-ID and file disposition survive transport.
- [x] Browser abort and response-reader cancellation reach upstream. Network failure does not assert `accepted:false`: the Agent may have executed the POST before connection loss.
- [x] Fixture HTTP tests 6/6; Web 859/859; Server package build/root TypeScript passed; lint 0 errors / 12 existing warnings. Forcing upstream status to 200 fails two tests; restored tests pass. All execution in Docker.

## Remaining before Task 9 completion / Phase 3 activation

- [ ] Browser `resync_required` recovery: HTTP 409 passes through unchanged, but native EventSource hides its response body. Integrate with existing state/context reconciliation, never resend prompts. Preserve cursors across application-created reconnects (current AgentEventConnection replaces EventSource instances).
- [ ] Compare inactive adapters against real Agent Server and the browser API baseline, not only the transport fixture. In particular, structured Agent errors versus browser string errors and GET state auto-start versus baseline `{running:false}` semantics need explicit compatibility handling.
- [ ] Implement/verify Agent-side bash-output endpoint before enabling its BFF adapter; the adapter alone does not supply file access authorization or storage.
- [ ] Recheck prompt-acceptance failure semantics and browser source wiring before public handler replacement.
- [ ] Complete Phase 2 end-to-end acceptance and subsequent Phase 3 migration gates.

No public `app/api/agent/*` Route Handler, browser hook, local Runtime, image, or vendor artifact changed in this checkpoint. Activation will pass the existing `agentFetch` to `createRemoteAgentRoutes`; there is no fallback to local execution in these adapters.
