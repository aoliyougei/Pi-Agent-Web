# Pi 1.4.0 Web compatibility — real candidate acceptance evidence

## Status and release gate

Web source accepts exactly Pi `0.84.4`, `1.2.0`, and `1.4.0`. Protocol v1 and all existing required capabilities remain mandatory. Adjacent, prerelease, and arbitrary future versions are not implicitly supported.

Real-candidate checks and the three requested supplemental scenarios have now passed (see results below). This is Web-side execution evidence, not a claim that RPC has independently reviewed the logs or authorized release. No formal image has been published; keep publication on hold pending coordination. Do not change protocol v1, cwd hints, commands, SSE, or the RPC repository as part of this work; coordinate any discovered required interface change first.

## Local evidence

Docker-only Web tests cover:

- Exact version admission, legacy versions, unknown versions, protocol mismatch, and removal of each required capability.
- Server `usage.cost.total` for `cost.totalFromProvider` absent, false, and true. Totals deliberately differ from the sum of estimated components, including a zero billed total. No client recomputation.
- Malformed tool argument normalization for null, array, string, numeric, and object values; preserve `argumentsError` and render it as escaped text.
- New-session preference initialization is excluded for existing sessions. Passive hook paths cannot issue `set_tools`; explicit user selection retains the command. These hook guard tests inspect source; they are not a substitute for browser network capture.
- Existing model startup/switching and thinking-level tests; restored `off` is no longer discarded.
- Both compaction event naming conventions, reconciliation, and event transport replacement with continued messages. Simulated SSE replacement is not proof of process-restart persistence.
- Kimi custom Base URL hints when `/v1` is missing; the hint does not rewrite configuration. Custom aliases with unrelated hostnames cannot be identified automatically.

Docker verification: Web suite **619/619 passed**, `tsc --noEmit` passed, and ESLint passed for modified code/test files. A production-mode **local-only test candidate** was built for the real integration checks; no registry image was published.

## Required RPC handoff

RPC identity was inspected in the shared daemon: `pi-agent-rpc@sha256:11ee30f6798174db1b26bf906da61cfea5cb5b7518d517d1982fd2d69c48f858`, amd64. No registry pull or push was needed. Web local candidate: `pi-agent-web:pi140-joint-candidate`, image ID `sha256:14257d652ac4fcc1ec70c53a54e137bf0250534f278b8d6e2ca7f298f329e6eb` (not a published registry digest).

Actual version response through Web: protocol `1`, server `0.3.0`, Pi `1.4.0`, revision `4a080252f06caf63a525d7873c5d94d3c23887e0`, capabilities `extension-ui`, `custom-ui`, `remote-files`, `subagents`, `session-locks`, `project-session-discovery`.

Fixtures were copied read-only from `/app/Pi-Agent-RPC` into task-owned containers, not modified in that repository. `scripts/fixtures/pi140/phase2.ts.txt` and `malformed.test.mjs` retain those supplied fixtures. Official v1.4.0 does **not** natively report `cost.totalFromProvider`; its fixture coverage proves optional-field transport/display tolerance only, not actual billed-cost availability.

## Joint acceptance checklist

1. **Admission and compatibility**: capture candidate version response (Pi 1.4.0, protocol v1, required capabilities). Confirm old Pi 0.84.4/1.2.0 fixture responses still pass and mismatched protocol/missing capabilities fail.
2. **Models and thinking**: use deterministic models with differing supported levels and thinking-level mappings. Verify `/api/models`, displayed model selection, explicit switches, `off`, and server-restored levels after reload/reconnect. Defaults must not overwrite explicit or persisted choices.
3. **Tools on restore**: prepare sessions with absent legacy selection, explicit nonempty tools, and empty tools (Chat only). Set a conflicting browser preference. Cold-open, reload, reconnect, and restart RPC; capture requests and assert there is no automatic `set_tools` or default `toolNames` in existing-session prompts. Confirm server state is unchanged. Explicitly change tools in the UI, verify one `set_tools`, effective server tools, and persistence across restart. Create a new session separately and confirm its selected preference is applied at creation.
4. **Malformed calls**: deterministic model emits malformed JSON/nonobject arguments followed by the server tool error. Verify readable `argumentsError`, no crash, no successful tool execution for invalid arguments, correct paired result, and reload parity.
5. **Compaction/SSE/restart**: trigger manual and automatic compaction; refresh and reconnect midstream, record SSE IDs/cursors and state reconciliation. Restart RPC with session storage preserved, reopen via cwd hint, continue the same session. Verify prior messages, tools, model, thinking, compaction context, no duplicate message or stale streaming bubble, and ability to complete a new prompt. Include scoped project and global sessions; no LIST warmup dependency.
6. **Cost**: fixtures cover `cost.totalFromProvider` absent/false/true, zero and nonzero total, and total differing from components. Verify displayed total equals server value both live and after reload; inspect session aggregate stats separately to ensure server totals are used there too.
7. **Kimi**: custom missing-`/v1` URL displays advice, including a recognized custom host; saved value remains byte-for-byte unchanged until explicit user editing. Valid `/v1` URL has no warning. Do not invoke paid models just for this check.

## Executed results (2026-10-23)

Task-owned containers: `pi140-joint-rpc`, `pi140-joint-web`, `pi140-joint-browser`; no host mounts or exposed host ports. RPC runs as a real CLI child with a random 0400 token and disposable agent/project data. The loopback relay injects RPC authentication and records only request metadata (no authorization headers or token values). Web uses a separate disposable token file for its existing configuration boundary.

| Scenario | Result / evidence |
| --- | --- |
| Actual authenticated version | Passed via Web; exact response in `verification/pi140/pi140-web.log`. Unknown/legacy versions and required-capability failures remain covered by Web tests, not old real RPC binaries in this run. |
| Model list and thinking | Real `phase2/echo` listed; medium/off/high set and confirmed by `get_state`; deterministic prompt returned `echo:joint hello`. Chromium explicitly selected `off` and retained it after refresh. |
| Cold tools, all three classes | Default and explicit read restore as `read,new_tool`; removed_tool/inactive_tool/bash absent. Chat only restores empty. |
| Browser cold open / refresh | All three tool classes passed with conflicting browser preference. Captured passive requests contain no `set_tools`. |
| Browser reconnect | Default-tool session active stream was closed and errored, replacement source connected, response arrived. No tool override. Explicit-nonempty and original Chat-only matrix passed in supplemental run below. |
| Explicit user tool change | Real UI switched explicit session to Chat only; exactly one `set_tools` observed; effective empty tools survived real RPC restart. |
| New-session creation | Real API creation with empty and default builtin sets passed. Empty-tools session must omit the extension-only echo model (extensions do not load in Chat only). Fresh composer preference through browser passed in supplemental run below. |
| Malformed arguments projection/UI | Legal temporary JSONL -> real detail -> browser error text passed. Separate supplied actual SDK Agent test passed with executed=0, requests=2 and error tool result. |
| Cost fixtures | Absent/false/true preserved by RPC. Expanded browser process details show all four $0.1250 totals, not $10.0000; aggregate $0.50. Zero costs covered by Web regression. |
| Manual compaction | Completed with compaction_end, isCompacting=false, later prompt succeeded. Initial run failed because tiny-model auto compaction had already compacted; manual test disables auto compaction before generating new rounds. No product code changed for this. |
| Automatic compaction | New persisted compaction entry count increased after enabling auto compaction and prompting; idle state cleared. |
| Ordered SSE replay | Two name events replayed in order from real event cursor; trace confirms cwd + Last-Event-ID. |
| Expired cursor | Real RPC returns 409 resync_required; Web's **existing** translation returns 200 SSE `resync_required` so EventSource can read it. Initial test incorrectly expected 409 at the browser boundary; corrected assertion, no protocol change. |
| True RPC process restart | Project cold cwd validation -> detail -> SSE -> prompt, without LIST; same JSONL appended. Separate global session also cold-opened and appended to original global JSONL after real restart. |

Raw successful outputs are in `docs/verification/pi140/`. `pi140-trace.json` holds 3,755 request-metadata entries, including setup and retries; it is not a statement that every request is a separate successful test. Scripts are sequential fixture harnesses; `pi140-joint-extra.mjs` expects the explicit session already switched to Chat only by the browser check. Do not replay the whole suite against a mutated fixture root without resetting/recreating it. The model browser check runs after automatic compaction, which changes the visible retained messages.

### Reproduction notes

Upload the RPC fixture files to `/tmp/joint` (name the text fixture `phase2.ts` inside the RPC container; its local `.txt` suffix keeps a foreign fixture out of the Web TypeScript build) and `scripts/pi140-joint-rpc.mjs` into the pinned disposable RPC image. Run that script to start the actual CLI and relay on 8080/8081. Start the locally built Web candidate in the same isolated network namespace with `PI_AGENT_RPC_URL=http://127.0.0.1:8081`; supply an independent user-owned 0400 Web token file (relay discards its value). Use a Docker-only Chromium peer with Chromium at `/usr/bin/chromium` and Playwright at `/tmp/web-browser/node_modules/playwright`.

Run `pi140-joint-web.mjs`, then `pi140-joint-browser.mjs`, then `pi140-joint-extra.mjs`, then `pi140-joint-model-browser.mjs`. For the supplied malformed execution test, rewrite only its package import locations to installed absolute module paths inside the disposable RPC image and run `node --test`; do not change its assertions. Global continuation and new-session creation checks were additional one-off commands, recorded in this table rather than claimed as rerunnable script coverage.

## Supplemental acceptance: all three requested gaps passed

Same RPC container/image identity and same Web candidate image were reused. Fresh disposable fixtures use a local OpenAI-compatible HTTP echo provider (`joint/echo`), so original Chat only can call a deterministic model without loading extensions. The provider has `/gate`, `/gate-state`, and `/release` controls in the test relay; no production RPC modification is involved.

- **Nonempty tools active reconnect**: explicit fixture active tools `new_tool,read`. Gate holds the model request, browser EventSource is closed/errored, replacement connects before release, then the actual browser receives `echo:remaining reconnect explicit`. Active tools unchanged, no automatic `set_tools`.
- **Original Chat only active reconnect**: same sequence with its original empty persisted tools and conflicting `full` browser preference; actual follow-up reply arrives, tools remain empty, no automatic `set_tools`.
- **Fresh browser composer**: click New, then the actual System prompt control to lazily create the composer session. Browser request applies `[]` for Chat only and `[read,bash,edit,write]` for default. Verify actual active tools and confirm the existing original Chat-only session remains empty. Original timeout was a locator error: accessible name is `System prompt`, not visible label `System`.
- **Refresh during compaction**: explicit fixture has three completed warmup turns. Gate the real summary provider response; verify pending model response and `get_state.isCompacting=true`, then reload. Refreshed UI exposes Stop compaction and state remains true. Release response, receive real `compaction_end` in refreshed browser, UI returns to Compact context, persist exactly one additional compaction record, submit/receive a later prompt. Trace contains exactly one compact command and zero set_tools; tools unchanged.

Successful output: `verification/pi140/pi140-remaining.log`. Browser request timestamps, gate observations, refreshed SSE event types, tool states, and compaction record counts: `pi140-remaining-evidence.json`. RPC forwarding metadata: `pi140-remaining-trace.json` (237 entries including setup and initial failed fixture run; no tokens or Authorization headers).

The first supplemental run timed out at the model gate because seeded assistant messages still named phase2, causing SDK restoration to select the extension model rather than the fixture HTTP model. `get_state` proved the mismatch. Setup then explicitly selected `joint/echo` for both sessions via Web before retry; the checked-in fixture now seeds matching joint model/assistant metadata. This was a fixture mismatch, not a product fix.

To reproduce these supplemental scenarios from a clean root: upload current `pi140-joint-rpc.mjs` plus fixture extension to the same pinned RPC image, start its relay/CLI, then run `pi140-joint-remaining.mjs` in the Chromium peer. Do not mix the old sequential harness expectations with this updated model fixture. Model provider requests remain local and unpaid.

No product source was changed between original and supplemental candidate tests; final Web candidate remains local image ID/manifest digest `sha256:14257d652ac4fcc1ec70c53a54e137bf0250534f278b8d6e2ca7f298f329e6eb`. No classifier/image-generation, share, or telemetry UI was added. No formal image is authorized for publication by this evidence alone.

## Release authorization

After supplemental acceptance, the operator explicitly authorized integration into main, Git tagging/push and Docker tagging/publication as `v0.2.6` / `0.2.6` (plus `test`). Release changes update version metadata only; the application source is the tested candidate source. Deployment remains a separate operator action. Earlier publication-hold statements above describe the acceptance phase, not a continuing block after this explicit authorization.
