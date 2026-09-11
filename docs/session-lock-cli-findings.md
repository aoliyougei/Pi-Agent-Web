# CLI Session locking: pre-write boundary review

Task 8 is not implementation-ready with a shell wrapper plus an ordinary extension alone.

Reviewed upstream Pi 0.84.4 (source remains unchanged):

- `packages/coding-agent/src/main.ts`: initial session selection calls `SessionManager.open`, `continueRecent`, or `create` before runtime extension binding. `--resume` selects a path interactively inside Pi.
- `packages/coding-agent/src/core/session-manager.ts`, `_setSessionFile`: opening an empty file initializes and rewrites it; opening an older session may migrate and rewrite it. Locking at `session_start` is too late even when no prompt has been sent.
- `packages/coding-agent/src/core/agent-session-runtime.ts`: subsequent `switchSession` and JSONL import have a cancellable `session_before_switch` hook before target writes. Fork/new-session flows also create target state internally.
- `packages/coding-agent/src/core/extensions/runner.ts`, `emit`: extension exceptions are caught and emitted as errors. A thrown lock conflict is not a fail-closed cancellation; handlers must return `cancel: true` where supported.

Consequences:

1. A startup-only shell `flock` cannot protect interactive target selection or subsequent target switches.
2. A session-start extension cannot guarantee pre-write exclusion for the initial open.
3. A process-global CLI lock would violate the requirement that distinct Sessions can run concurrently.
4. Rejecting resume/continue/TUI switching would violate feature parity.

Design options reviewed (user subsequently approved the preload/interception option):

- Host the CLI/TUI through a maintained SDK adapter that owns initial selection and every writable session transition; verify behavioral parity with upstream CLI before claiming supported coverage. This is more than a thin shell wrapper.
- Alternatively permit a mandatory process preload/interception adapter, outside the upstream source tree, that guards actual SessionManager write/open boundaries. This preserves upstream files but changes runtime behavior and introduces version-specific interception that must be explicitly approved and comprehensively tested.

## Implementation checkpoint

The user approved proceeding with the mandatory preload/interception adapter. Do not ask again for this same design decision.

- [x] Shared OS lease primitive: exact `fs-ext@2.1.1`, canonical path hashing, nonblocking kernel flock, metadata without stale-file deletion, idempotent release.
- [x] Real Node child-process and shell flock interoperability tests; normal exit and SIGKILL release; symlink aliases before file creation; lock-removal mutation is detected.
- [x] Inactive SDK adapter checkpoint: wraps `_setSessionFile` before initialization/migration, `newSession`, `_appendEntry`, `_rewriteFile`, and `_persist`; reference-counted per-manager leases and explicit release. Tests use real SDK objects, a separate Node process, and detect removal of the open guard. Focused 5/5; server 233/233; Web 853/853; root TypeScript passes.
- [ ] Mandatory version-bound CLI preload, protecting initial opens and later writes/transitions before mutation, including migration and JSONL import. The adapter is NOT installed by production yet. Remaining coverage: disk-write failure handling/integrity checks; lifecycle disposal and read-only browsing must not leak manager references/leases. Same-process active-manager conflicts beyond concurrent imports still need lifecycle ownership enforcement; initial runtime factory failures (outside AgentSessionRuntime replacement methods), reload/disposal outside this host, and nested callback-created runtimes require additional ownership tests.
- [x] Invalid-target switch and newSession lease-conflict rollback restore the previous in-memory branch and retain its lease; removing rollback fails both regression tests. The guard now checks the imported SDK `VERSION` and exact `SessionManager` identity, not just the caller's version string (this is not a cryptographic integrity check). Direct `setSessionFile` normalizes Linux `~` and `file://` inputs before choosing the lock key, matching Pi. Focused 8/8; server 236/236; Web 853/853; package build and root TypeScript pass in Docker.
- [x] Inactive JSONL import adapter holds a temporary destination lease before upstream `copyFileSync`, including across async extension hooks; rejects concurrent same-target imports, releases the temporary reference on cancellation/missing source, and shares ownership with the newly opened manager on success. Real SDK import method + SessionManager with fixture runtime services: 5/5. Removing the pre-copy lease makes the byte-preservation test fail. Full server 241/241, Web 853/853, package build and root TypeScript pass in Docker. This does not claim rollback of upstream copy errors or cleanup after runtime-construction failure.
- [x] Inactive SDK Runtime lifecycle adapter: releases source only after successful teardown/dispose, scopes target-manager allocations via AsyncLocalStorage, and cleans unadopted managers on failed switch/new/import without touching concurrent unrelated allocations. Adopted target stays locked when a post-switch callback fails; shutdown/dispose failure retains source. Real SDK runtime/manager + fixture session services: 8/8; removing scope cleanup fails 3 tests. Server 249/249, Web 853/853, package build/root TypeScript pass. This does not activate CLI or cover Pi Web's separate SessionRuntime disposal path.
- [x] Inactive fork adapter: holds source while upstream `forkFrom` runs; temporarily intercepts synchronous `writeFileSync` to reserve its generated target before first write, restoring fs exports in finally. No upstream serialization duplication. Numeric-fd metadata writes bypass interception. `createBranchedSession` holds deferred user-only targets and restores source state/ownership on branch write failure. Real SDK tests 6/6; removing target reservation fails pre-write byte-preservation test. Server 255/255, Web 853/853, build/root TypeScript pass. Assumption: Pi 0.84.4 forkFrom stays synchronous without user callbacks; complete package integrity verification is still required. Partial I/O failure rollback on newly created fork files is not claimed.
- [x] Explicit CLI preload checkpoint (`node --import .../cli-preload.js`), not yet installed as the container's standard `pi` entrypoint. Original Pi CLI RPC-mode processes reject separately held sessions for `--session` and `--continue`, retain ownership while serving commands, transfer leases on `new_session`/`switch_session`, preserve the current session after a blocked switch, and release on SIGKILL. No NODE_OPTIONS injection into tool descendants. CLI tests 2/2 with multiple command transitions; disabling preload fails the ownership assertion. Contract 7/7, server 257/257, Web 853/853; builds/root TypeScript pass in Docker. Counterparty is a test lease holder, not the Agent Server; interactive TUI, startup failures/reload/read-only manager cleanup and packaged entrypoint acceptance remain pending.
- [ ] RPC ownership and lifecycle release; map conflicts to HTTP 409 `session_locked`.
- [ ] CLI wrapper/image native dependency build; actual CLI/RPC contention and upstream-integrity acceptance checks.

Primitive verification: focused 4/4, Agent Server 228/228, root Web 853/853; package builds and root TypeScript pass in Docker. These tests are not proof of CLI/RPC entrypoint enforcement. The primitive is intentionally not activated until lifecycle coverage is verified. Native `fs-ext` must be explicitly compiled in the image runtime-builder before refreshed vendor artifacts can be shipped (its current `--ignore-scripts` install is insufficient).

