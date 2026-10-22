# Selected-workspace project sessions implementation plan

> Implement task-by-task using test-driven development. Execute dependency installation, tests, type checks and builds in Docker only. RPC work is handed to the separate RPC project agent; paths below identify the corresponding implementation in this repository, not permission to deploy or modify that separate repository.

## Goal and agreed scope

- Keep existing global session discovery unchanged.
- When Web selects a local working directory, additionally discover JSONL files directly in `<selected cwd>/.pi/sessions/` only. Do not recurse into child projects, scan sibling projects, infer the Git root, or remember a permanent registry of previously selected projects.
- Switching cwd replaces the additional persisted-project discovery scope. It does not delete files or terminate other running sessions. Existing live-session reporting remains intact.
- No cwd means global discovery only. This avoids silently choosing RPC process.cwd() as a discovery scope.
- Missing `.pi/sessions` means an empty additional list, not an error or directory creation.
- Discovery scope and write location are independent. New Web sessions follow effective Pi `sessionDir` settings for their cwd; absent settings retain SDK default global storage. Relative values resolve against that cwd. Discovery of other arbitrary custom storage locations is out of scope.
- Do not migrate, rewrite or move existing sessions automatically.

## Shared API contract (confirmed with RPC agent)

1. Extend `GET /internal/v1/api/sessions` with optional `cwd=<absolute path>`; public Web route remains `GET /api/sessions?cwd=...&force=1`. Preserve existing response fields and force semantics.
2. Add an advertised capability named `project-session-discovery` to RPC version data. RPC confirmed this name; version parsers accept extra string capabilities. Keep this capability optional, not a new unconditional minimum-version requirement for existing backends.
3. A selected-workspace hint must also reach cold ID-based reads and mutations, not just LIST. Use optional `cwd` query on public/internal `/api/sessions/:id` routes and `cwd` on JSON agent command requests that need to open a saved session. Treat it as an explicit lookup scope, never permission to change the cwd recorded in an existing session header. Confirmed: query cwd for session/agent reads, events and resources; top-level JSON cwd for POST /agent/:id, stripped before SDK command parsing. RPC-generated media URLs carry their own hint.
4. Resolve IDs by verifying session file headers in authorized global roots and, when cwd is supplied, the selected project's `.pi/sessions`. Cached IDs are an optimization, never a substitute for correct cold lookup or path authorization. Return deterministic conflict for ambiguous distinct files with the same ID rather than arbitrary selection.
5. Reuse existing path-selection/access authorization and canonical path comparison. Project discovery must not independently authorize its own cwd; match established `cwd/validate` semantics. Validate absolute paths, symlink escapes, JSONL headers and regular-file types. Do not expose an arbitrary browser-supplied session file path endpoint.
6. Invalid or inaccessible cwd uses the existing API error envelope and an appropriate non-success response. Missing project-session subdirectory alone is not a failure. Preserve global-only compatibility when cwd is absent. Non-404 filesystem failures must not be silently turned into empty success.

## Review focus

- Parallel browser tabs may select different cwds: discovery and cache scopes must not overwrite one another.
- RPC restart plus a Web deep link must resolve a project session without a previous LIST call.
- Selecting a cwd with no global sessions must remain selected while its first project session is discovered.
- Session headers, file paths and symlinks must not allow out-of-scope reads or writes.
- Session ID collisions, deleted folders, stale list responses and missing parent/fork files must not misroute operations.

## Task 1 — RPC discovery and cold lookup

Reference files:
- `packages/pi-web-agent-server/src/routes/sessions.ts`
- `packages/pi-web-agent-server/src/dependencies/session-reader.ts`
- existing filesystem/path-access helpers and RPC capability definitions

- [ ] Add failing tests: global + selected-project union; A/B scope isolation; no-cwd global-only; missing project directory; no recursion; no Git-root substitution; Unicode/spaces; invalid cwd and permission failures.
- [ ] Add cold-lookup tests: resolve ID and reverse path without list cache; duplicate ID rejection; session file regular-type/header validation; symlink escape rejection; RPC restart behavior; all global-only regressions remain green.
- [ ] Implement optional cwd propagation through list route, list reader, ID/path lookup and their caches. Keep global cache reusable, but key any combined catalogue by normalized cwd and ensure invalidation/force works for every affected scope. Cached paths must not bypass authorized-root checks.
- [ ] Preserve current live runtime list merge, branch metadata and session sorting. Build the global/project union before resolving parent links; do not discover another project's files solely because a parentSession header references them.
- [ ] Run relevant RPC tests, complete RPC suite, lint and typecheck in Docker. Commit separately.

## Task 2 — RPC new-session storage and operation coverage

Reference files:
- `packages/pi-web-agent-server/src/runtime/session-runtime.ts`
- runtime adapters, session command schemas, and existing session-lock helpers

- [ ] Write failing tests for effective global/project Pi setting precedence, relative and absolute sessionDir, unset default, and two cwds using the same relative value.
- [ ] Use SDK settings loading and path normalization for effective cwd-specific settings; pass resolved directory to new-session creation. Reuse that decision across actual creation entry points where their existing semantics call for it. Existing-session opens continue to use the real persisted file path.
- [ ] Audit and test prompt/resume, state, context, export, rename, delete, fork/clone and subagent creation. Carry the explicit lookup cwd where needed; preserve lock acquisition/release and existing fork destination semantics unless SDK settings require otherwise. Do not change an existing session's recorded cwd to match the hint.
- [ ] Ensure cache invalidation and post-delete lookup are correct for project files. Test restart before direct detail/prompt/delete to prove no accidental reliance on memory cache.
- [ ] Publish capability and accepted request fields, retaining old-client global-only behavior. Provide the Web agent with capability name, concrete request/response examples and passing tests before integration.

## Task 3 — Web selected cwd and cold navigation

Files to inspect/change as needed:
- `components/SessionSidebar.tsx`
- `components/AppShell.tsx`
- `hooks/useAgentSession.ts`
- `lib/agent-client.ts`
- `lib/agent-rpc/routes/sessions.ts`, `routes/agent.ts`, and related existing adapters/tests
- existing backend-scoped workspace-memory helpers

- [ ] First add failing tests for cwd encoding/force preservation, selection-driven reload, fresh project with no global sessions, slow response from cwd A arriving after B, backend switch and multi-tab behavior.
- [x] Read RPC capability; only enable project-discovery requests when advertised. Older RPC remains usable for global sessions and must not falsely advertise project-session support. Do not make this an unconditional compatibility requirement.
- [ ] Supply selected cwd to LIST; trigger refresh after dropdown, custom path validation and worktree selection. Avoid startup loops caused by list responses resetting a valid custom selection. Ignore stale success/error/loading updates after selection or backend changes using the existing request-generation pattern or an abort guard.
- [ ] Keep selected-project restoration backend-scoped. Restore the cwd hint before requesting a deep-linked project's detail/commands; use the confirmed shared contract for every required ID-based endpoint, including delete/export/state/context and prompt/resume. Do not assume a preceding list request registers a scope globally in RPC.
- [ ] Keep no-cwd initial list global-only. A deep link lacking both a discoverable global session and any workspace hint must show a useful select-workspace message, not scan the disk. Reloading a known project session should use the existing persisted workspace/session association; if current association is insufficient, persist the minimum backend-scoped session-ID-to-cwd hint, not a server project registry.
- [ ] Test that the Web proxy preserves query hints and allowed JSON command fields without inventing filesystem access or local execution. Session response shape and UI grouping stay unchanged.
- [ ] Run focused tests, complete Web suite, typecheck and lint in Docker. Report any environment-blocked integration tests explicitly.

## Task 4 — cross-service acceptance and release

- [ ] Deploy updated RPC first in a test environment, then updated Web. Test older RPC compatibility as well as new capability behavior.
- [ ] In CLI, with `sessionDir: .pi/sessions`, create a session inside project A. Select A in Web and verify list, content and continuation.
- [ ] Select B: A's additional persisted project entries disappear, B's appear; global sessions remain available and active runs are not stopped.
- [ ] Web-new session in A lands in A/.pi/sessions. With sessionDir unset, Web-new session lands in SDK default global storage. Also verify an absolute sessionDir write destination without claiming arbitrary-dir discovery support.
- [ ] Restart RPC; refresh a project-session deep link and test continue, export and delete using disposable test sessions. Never delete user sessions as test fixtures.
- [ ] Confirm no sibling/subproject scanning, no directory creation on listing, no automatic file migration and no real-path boundary bypass.
- [ ] Release only after both agents agree on the implemented contract and acceptance results. Version tags, registry pushes and deployment remain separately authorized operations.
