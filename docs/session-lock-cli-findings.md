# Task 8 — Session locks and supported CLI entrypoint

## Status

Implemented and acceptance-tested on Linux with Pi 0.84.4. This closes Phase 2 Task 8, not Phase 2 or the overall container split.

## Approved adjustment

A shell startup lock or ordinary Extension hook alone cannot protect interactive session selection, migration-on-open, or later `/resume` and import. The user approved a mandatory version-bound preload maintained in Agent Server, outside upstream Pi. Exceptions in Extension handlers are not a reliable fail-closed boundary.

The standard container entrypoint is now:

```
/usr/local/bin/pi                     # shell wrapper
/usr/local/libexec/pi-real            # symlink to original dist/cli.js
node --import <server>/dist/runtime/cli-preload.js /usr/local/libexec/pi-real ...
```

Important image finding: upstream's default executable points to `dist/bundle/cli.js`, which embeds a different SessionManager instance. Preloading SDK hooks cannot guard that bundle. The wrapper must run upstream's unmodified modular `dist/cli.js`. The bundle remains available internally. NODE_OPTIONS is not used, so tools do not inherit the preload.

## Implemented boundaries

- `fs-ext@2.1.1`, nonblocking kernel flock, SHA-256 of canonical Session path, existing-ancestor/symlink normalization for files not yet created. Metadata is informative only; no stale-lock deletion. Kernel exit/SIGKILL cleanup.
- CLI open/continue/new/switch, branch/fork, import, shutdown, and failed transitions. Import holds the destination through async confirmation and rejects concurrent same-target imports. Source/target branch ownership transfers without a write-before-lock gap.
- Selector deletion acquires an independent lease before trash/unlink and displays conflicts; rename releases transient managers. Read-only `SessionManager.list` does not require a write lease.
- RPC existing/new startup, inactive `set_tools`, fork/clone destinations, Subagent startup and final metadata lifetime. Prompt/state/SSE/pending-UI lock conflicts return `409 session_locked`.
- RPC shutdown rejects new commands, cancels dialogs/active work, waits for outstanding mutations/prompts, then disposes before unlocking. A stuck operation retains its lease until it settles or the process exits; force-unlocking an active writer is unsafe.
- Empty RPC forks are persisted under the target lease so their IDs remain reopenable.
- Runtime-builder explicitly compiles native fs-ext using the image's Node headers. Build dependencies stay in the builder stage.

## Acceptance evidence

All execution used Docker API containers, no host mounts or local project execution.

- Agent Contract: **7/7**.
- Agent Server: **262/262**.
- Pi Web: **853/853**.
- Package builds and root TypeScript: passed.
- ESLint: exit 0, **0 errors / 12 warnings** (including generated dist warnings).
- Deterministic package tests: **2/2**; vendor SHA-256 verification passed during the official Dockerfile build.
- Real installed `pi` ↔ `pi-agent-rpc`: both directions reject competing ownership, independent sessions coexist, read-only listing works, SIGKILL and SIGTERM release locks.
- Real PTY interactive CLI: `--session` and `--resume` select/open and hold a Session; competing CLI is rejected; exit releases ownership.
- Source tree comparison against the original Pi snapshot: no differences. All **877 Pi dist files** checked against the Phase 1 image have identical hashes.
- Mutation checks detect removed primitive locks, pre-open guard, import pre-copy lease, fork destination lease, Runtime cleanup, CLI preload, RPC acquisition and RPC clone destination lease.

Reproducible image checks are in `pi-agent-rpc/tests/verify-session-lock.mjs`, `verify-session-lock.sh`, and `verify-cli-tui.py`. The Python PTY test needs Python only in its disposable execution container, not in the release image.

## Support boundary and maintenance

This is advisory, Linux, single-active Agent Server locking. It covers the supported container `pi` entrypoint and server paths; bypassing the wrapper via internal Pi binaries or custom code directly editing JSONL is unsupported. Paths, not hard-link inode aliases, define Session identity. Existing upstream partial-I/O semantics are unchanged: this work prevents competing writers; it is not a transactional filesystem or recovery system. Same-process SDK managers can share a lease for legitimate previews/replacements; only concurrent import operations are independently excluded at that layer.

The synchronous fork/copy interceptors assume the pinned Pi implementation has no asynchronous yield or user callbacks in those operations. Every upstream upgrade must repeat source review, SDK/CLI/PTY tests, and image integrity checks. Global selectors/preload are process-local and installed once. Public browser BFF migration, deployment manifests, and release hardening remain later tasks.
