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
- [ ] Mandatory version-bound CLI preload, protecting initial opens and later writes/transitions before mutation, including migration and JSONL import.
- [ ] RPC ownership and lifecycle release; map conflicts to HTTP 409 `session_locked`.
- [ ] CLI wrapper/image native dependency build; actual CLI/RPC contention and upstream-integrity acceptance checks.

Primitive verification: focused 4/4, Agent Server 228/228, root Web 853/853; package builds and root TypeScript pass in Docker. These tests are not proof of CLI/RPC entrypoint enforcement. The primitive is intentionally not activated until lifecycle coverage is verified. Native `fs-ext` must be explicitly compiled in the image runtime-builder before refreshed vendor artifacts can be shipped (its current `--ignore-scripts` install is insufficient).

