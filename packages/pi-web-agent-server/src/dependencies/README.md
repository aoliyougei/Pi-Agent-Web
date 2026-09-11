# Agent runtime dependency closure

Generated from `lib/rpc-manager.ts` at Pi Agent Web commit `3e04ccd` and reviewed before relocation.

Agent-owned modules:

```text
agent-event-wire.ts
allowed-roots.ts
api-types.ts
atomic-file.ts
chat-only.ts
custom-ui-terminal.ts
frontmatter.ts
i18n/messages/en.ts
i18n/messages/zh-CN.ts
i18n/types.ts
image-attachments.ts
middleware/ssh-remote-status/ssh-environment.ts
model-scope.ts
models-cache.ts
normalize.ts
path-security.ts
paths.ts
pi-types.ts
powershell-settings.ts
project-command-env.ts
project-identity.ts
project-trust.ts
session-path.ts
session-reader.ts
session-tool-selection.ts
startup-preferences.ts
subagent-extension.ts
subagent-input.ts
subagent-prompt.ts
subagent-runtime.ts
subagent-settings.ts
subagents.ts
tool-presets.ts
tool-result-images.ts
types.ts
web-push.ts
worktree.ts
```

`rpc-manager.ts` itself is migrated in the next task after this closure builds independently.

External runtime dependencies:

```text
@earendil-works/pi-agent-core@0.84.4
@earendil-works/pi-ai@0.84.4
@earendil-works/pi-coding-agent@0.84.4
@earendil-works/pi-tui@0.84.4
js-yaml
proper-lockfile
web-push
```

Node built-ins (`child_process`, `crypto`, `fs`, `path`, `util`) remain Agent-only. The sole `@/` alias in the source closure must be converted to a package-relative import. No module in this directory may import React, Next.js, or escape to the Pi Agent Web application root.

Behavior-test helper modules (Agent-owned, not direct `rpc-manager.ts` imports):

```text
session-stats.ts
subagent-profile-precedence.ts
```
