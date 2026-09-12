# Phase 2 Task 9 — inactive Agent BFF adapters

Status: **Task 9 complete; public route activation remains gated on Phase 3.**

## Transport and browser compatibility

- `lib/agent-rpc/proxy.ts` forwards JSON/SSE/download streams once without buffering successful responses. Browser credentials/forwarded identity are excluded; the existing client injects the service token. Redirects are not followed, response cookies are stripped, and browser abort/reader cancellation propagate upstream.
- `lib/agent-rpc/routes/agent.ts` provides inactive new/running/state/command/events/bash-output adapters. Inject the existing `agentFetch` at activation. No local Runtime fallback.
- Structured internal errors become browser `{error: string, code, requestId, accepted?}` errors. Transport failures remain ambiguous: no automatic retry and no invented `accepted:false`. Real rejected prompts for missing sessions/invalid startup retain definite rejection semantics.
- Browser GET state uses internal `?start=false`, returning `{running:false}` without starting dormant sessions or acquiring writer locks. Internal default GET behavior is unchanged.
- Native EventSource cannot inspect an HTTP 409 body. The BFF translates **only** `resync_required` into a short SSE control event. All normal events, IDs, frames and heartbeats pass through unchanged; other conflicts remain errors.
- `AgentEventConnection` retains a session-scoped cursor across application-created reconnects; the BFF converts its query cursor into Last-Event-ID, with an actual Last-Event-ID header taking precedence. On resync it closes the old source, clears the expired cursor, waits for reconciliation, then reconnects without replaying a prompt.
- `useAgentSession` reuses existing Agent-state and persisted-context/state loading for reconciliation. Session/run guards prevent late snapshots from replacing a newer run. Legacy public streams have no cursor/control events and continue using the old path.

## Agent-side prerequisite

The authenticated bash-output endpoint now lives in Agent Server. It reuses migrated file helpers: temp-root and filename validation, exact bashExecution fullOutputPath reference, regular-file/no-symlink checks, bounded inline reads, and streaming downloads with disconnect cleanup. Forbidden files, oversized inline output, missing files, and symlinks have explicit tested responses.

## Verification (Docker only)

- Contract **7/7**; Agent Server **262/262**; Web **863/863** (includes new real-Agent HTTP integration).
- Contract/Server builds and root TypeScript passed; lint **0 errors / 12 existing warnings**.
- Fixture tests verify exact command bytes/status, credential isolation, redirects, stream forwarding and cancellation.
- Real HTTP Agent + SDK + Session files verify passive state, creation/commands, error compatibility, SSE/resync and authorized inline/download access, including symlink and size rejection.
- Connection tests verify cursor isolation, reconciliation ordering and header precedence. Dependency AST traversal forbids local execution/SDK imports in the inactive adapter closure.
- Mutation checks: removing resync callback or bash-output authorization fails tests; restored checks pass. Earlier forced-status mutation also fails the transport tests.

For the real integration test, build Contract and Server before `npm test` because it intentionally loads the packaged Server dist rather than mocking its implementation.

## Phase 2 acceptance

The deterministic Agent Server artifact was refreshed and imported into the RPC repository (`sha256:eb1da25c9d3bdb2e7cb136fdaa52674c73b83eedcd7f5c63c1bcd61338f90e49`). Docker acceptance passed for runtime commands, prompt lifecycle, SSE replay/overflow resync, ordinary Extension UI, `ctx.ui.custom()` keyboard input, CLI/RPC Session locking, Secret enforcement, authenticated two-container readiness, Agent outage, and recovery.

Fresh source verification: Contract **7/7**, Agent Server **262/262**, Web **863/863**, TypeScript clean, lint **0 errors / 12 existing warnings**. Pi source remained byte-identical across **1410 files**, and the installed Pi dist retained **877 files**. The frozen v0.2.5 compatibility tests are included in the passing suite; a fresh legacy-image rebuild for an additional direct comparison was blocked by repeated `ai-gateway.vercel.sh` DNS failures during upstream model-data hydration.

No public `app/api/agent/*` handler was switched and `lib/rpc-manager.ts` remains intact. `pi-agent-web-handshake:0.1.0-dev` remains labeled `io.pi-agent.release-ready=false`; no final `pi-agent-web:0.1.0` image exists. Phase 3 is the next gate for remote BFF activation and migration of remaining session/files/config/management APIs.
