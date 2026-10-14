# Pi Agent connections implementation plan

> Execute inline with executing-plans; no subagent tool is available.

**Goal:** Shared editable RPC connection profiles with an independent browser selection and a Logo-based settings page.
**Architecture:** Web-only private configuration files store profiles and tokens. A same-origin cookie selects the profile for every BFF request, including EventSource and file URLs. Switching reloads the page without a session/cwd URL so old streams and in-memory state cannot leak across backends.
**Tech stack:** Existing Next.js, React, Node filesystem, node:test; no new dependency.
**Spec:** Approved description in the conversation: all Web users manage shared profiles; tokens remain server-side; HTTP/HTTPS; no prompt replay or task cancellation.

## Constraints
- Do not modify Agent server or shared contract implementation.
- Execute installs, tests, typechecks and lint only through Docker API.
- Preserve deployment default profile; permit editing/deleting it with a persisted override/tombstone.
- Never silently fall back when an explicitly selected profile was deleted.
- Config directory is Web configuration, not an Agent project/data filesystem.
- Token storage is private (directory 0700, files 0600); never return tokens or include them in errors.
- All Web access is trusted administration under the approved permissions model.

## Review focus
- Deleted profiles return unavailable instead of choosing another backend.
- Tokens containing header control characters are rejected; redirects never receive tokens.
- Native EventSource and file URLs use the same browser selection as fetch requests.
- Workspace/session memories are scoped to the selected backend; switching must not discard another user's selection.
- Durable config and network egress are available in Compose/Kubernetes; no Agent volume is mounted on Web.

## Task 1: Private profile store and API
Files: lib/agent-rpc/backends.ts, backends.test.mjs; app/api/agent-backends/route.ts.
Interfaces: listBackends(), saveBackend(input), deleteBackend(id), getBackend(id); list responses contain id/name/baseUrl/hasToken only.
- [x] Write tests for CRUD, redacted listing, blank-token preservation, default override/delete, invalid IDs/URLs/tokens, private modes and symlink refusal.
- [x] Run in Docker and observe RED; implement store and body-limited API; observe GREEN.

## Task 2: Browser-selected RPC transport
Files: lib/agent-rpc/config.ts, index.ts, client.ts, client.test.mjs; lib/agent-backend-selection.ts and tests; workspace-memory.ts; local-workspace-memory.ts.
Interfaces: loadAgentRpcConfig(id = default), cookie pi-web-agent-backend; browser helpers getSelectedBackendId() and selectBackend(id).
- [x] Write tests for independent cookie selection and HTTPS acceptance / redirect refusal; observe RED in Docker.
- [x] Resolve profile per request through Next cookies; namespace workspace memory; page reload removes old navigation; observe GREEN.

## Task 3: Settings UI and deployment
Files: components/AgentBackendsConfig.tsx, SettingsPanel.tsx, AppShell.tsx, lib/settings-navigation.ts, lib/i18n/messages/{en,zh-CN,zh-TW}.ts, app/settings.css; Web Dockerfile and Compose/Kubernetes configuration/docs; tests/runtime-boundary.test.mjs and deployment tests.
- [x] Write UI/wiring and deployment regression tests; run RED in Docker.
- [x] Build accessible Logo cards and inline form; add settings entry, translations, external cookie-change reload; durable Web config volume and egress.
- [x] Run focused tests, root npm test, boundary/deployment tests, typecheck and changed-file lint in Docker. Report unrelated baseline failures separately.

## Execution ledger
- Workspace: .worktrees/pi-agent-connections, branch feat/pi-agent-connections, base a8f13a5.
- Ruling: use a shared selection cookie (per browser, including all tabs), not per-tab localStorage headers; this covers native EventSource/download/image requests without wrappers.
- Ruling: one atomic file per profile avoids shared-list lost updates; simultaneous edits use last completed write. Profiles may be resurrected by a concurrently completed edit after deletion.
- Ruling: implement inline and leave changes uncommitted for review; no merge/push/deployment is authorized.
- Docker verification: root npm test 585/585; runtime/Compose 7/7; Web Kubernetes checks 2/2; tsc --noEmit and changed-file ESLint exit 0.
- Live Turbopack HTTP verification: distinct cookies route to two task-owned mock Agents with the correct service token, browser cookies stripped; deleted selection returns 503, readiness and page return 200.
- Verification environment initially lacked built Agent dist and native fs-ext (npm ci --ignore-scripts); built the existing workspace and fs-ext in Docker only. No Agent source changes.
- Not verified: visual browser/mobile interactions, real external HTTPS backend or cluster/PVC deployment, production image build, RPC-repository Kubernetes fixtures (not present). No independent reviewer tool available; reviewed connected code inline.
- Existing dependency install reported 23 audit vulnerabilities; dependencies were not upgraded in this feature.

## Approved follow-up: standalone Web
- Removed mandatory entrypoint Token check and implicit default backend; explicit PI_AGENT_RPC_URL deployments remain compatible.
- Added missing-connection notice linking to Pi Agent settings, standalone web-only.yml with persistent volume, removed Agent health dependency from paired Compose.
- Docker RED observed for empty-default and startup tests, then GREEN. Root tests 585/585, standalone/boundary/Compose 8/8, TypeScript and changed-file lint exit 0.
- Live Docker dev server with no backend/Token: readiness/page 200, profile list empty, profile creation succeeds. Stop/start of the validation container preserved the saved profile and Token; public listing remained redacted. Entrypoint ran with no Token file.
- Container replacement with a named volume and production image startup remain unverified; no production image built. Kubernetes standalone adaptation is documented; the base remains the paired deployment example.
