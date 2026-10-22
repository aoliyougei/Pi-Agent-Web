# Project session discovery: Web integration

## Agreed behavior

- Global sessions remain available. Selecting a local RPC working directory adds only that directory's `.pi/sessions/*.jsonl` to discovery, regardless of settings. No recursion, sibling scan, Git-root substitution, migration, or server-side historical-project registry.
- RPC alone resolves effective Pi settings. `sessionDir` controls new-session storage, not discovery or continuation. Existing sessions continue in their original JSONL.
- Arbitrary other custom session directories are not newly discoverable by this feature.
- Running-session reporting remains global and switching directories never stops runs.

## Interface

RPC advertises optional `project-session-discovery`. Required capabilities are unchanged; version parsers must permit additional string capabilities.

- LIST: `/api/sessions?cwd=...&force=1`.
- Session/Agent reads, events, exports, entries, Bash output and remote-resource requests: query `cwd`; preserve existing parameters. Browser cursor still becomes upstream `Last-Event-ID`.
- Existing Agent POST commands: top-level JSON `cwd`, removed by RPC before SDK command parsing. New-session POST retains original cwd semantics.
- RPC-generated media URLs retain their existing explicit cwd.
- `cwd` is a lookup hint, never authorization or a replacement for persisted session cwd.

## Web implementation

`lib/session-scope.ts` owns backend-scoped session-ID-to-cwd hints and request preparation. Storage contains no session body, file path, or credential. Old backends keep their existing requests. Unknown/malformed version responses do not silently enable features.

Cold operations validate the hinted cwd with `/api/cwd/validate`, then send the normalized value. Concurrent validations are shared only while in flight: later operations revalidate so an RPC restart does not leave stale authorization assumptions. Validation errors stop delivery. Backend changes during preparation stop the original request.

The helper is explicitly imported by request owners, not installed as a global fetch interceptor. Sidebar LIST requests separately use the selected directory, and have generation guards against late success/error/loading updates. Custom paths remain selected even if their global list is empty. Deep links use a saved hint where available; without a hint, global lookup/known-project selection remains possible and the sidebar explains how to select the owning directory.

Session metadata is recorded before operating; new-session and fork IDs inherit their known local anchor. `SessionInfo.cwd` is the local anchor even for SSH sessions; remote terminal paths are not substituted. State, commands, SSE and file resources share these rules. File viewers prepare the scope before native resource/watch URLs render.

## Isolated verification (2026-10-22)

RPC candidate identity:

```
pi-agent-rpc:project-session-discovery-candidate
sha256:f126913ad141f44c22b0c8a6bff5ae88e837600f36dc23de676ceade26272659
```

Final Web candidate (not published, source not committed):

```
pi-agent-web:project-session-discovery-candidate
sha256:740cc9550e58760faa825a1cef1db5fa367d9efe4c7dfe41a607af96cd9694dc
```

Version metadata still reads Web project 0.2.3 / contract 0.1.0; the local candidate tag/digest, not that version string or inherited release-ready label, identifies this unreleased test build.

All execution occurred in task-owned Docker containers, with temporary session/config/token files, no production mounts or exposed host ports, and no paid model requests. A loopback-only fixture relay injects the random test credential; it is a test harness, not production proxy code.

Observed checks:

| Check | Result |
| --- | --- |
| Web root suite, after building workspace Server and native fs-ext in test container | 607/607 pass |
| Contract version tests | 5/5 pass, including unknown string capabilities |
| TypeScript | pass |
| Changed production/test-file ESLint | pass |
| Production Next build | pass |
| New Web -> candidate RPC HTTP | version, cwd validation, cold detail, global/project union, A/B isolation, Agent state, get_state POST, scoped SSE pass |
| New Web -> old RPC 0.3.1 HTTP | version and global list pass; optional discovery disabled, no extra hint validation |
| Published Web 0.2.3 -> candidate RPC HTTP | global list 200, version 503: published parser rejects the optional capability |
| Chromium against new Web dev and production servers | project deep link, reload, custom directory A -> B, same-project global row retention, delayed A response after B selection pass; no API errors observed |

The original full-suite failure was an unbuilt workspace Server, then missing fs_ext.node. Both prerequisites were built inside the test container and the suite was rerun successfully; the failure is not waived.

## Reproduction harnesses

- `scripts/project-session-rpc-check.mjs`: run in the candidate RPC container. For old RPC set `TEST_RPC_LEGACY=1`. Creates fresh temporary A/B and global fixtures, starts RPC and a loopback relay; stays alive until container stop.
- `scripts/project-session-web-check.mjs`: run in a Web builder container sharing the fixture's network namespace. Set `WEB_TEST_URL` to the isolated Web origin. Exercises the browser scope helper through real Web HTTP routes.
- `scripts/project-session-browser-check.mjs`: same network; requires disposable-container installation of Chromium and Playwright at the test-only path documented in its import. Runs real page navigation without model calls.

The helpers intentionally use test-image installation paths and are not portable production startup scripts. Test credentials are generated inside the container and never printed or checked in.

## Release constraints and remaining checks

- Do not deploy new RPC before old Web has been replaced by a compatible Web: the published 0.2.3 parser was observed to reject the new capability. New-Web-first is supported by the tested HTTP pair, not a blanket claim about all deployment configurations.
- This work does not modify the independent RPC source or publish either image. Candidate source is not yet committed.
- Web tests do not independently prove all RPC-side guarantees: actual model prompt persistence, config removal during a live run, duplicate-ID and lock/worktree cases remain covered by RPC agent's delivered results, not by this browser run. No paid prompt was sent. Test those with a deterministic provider before a joint production release.
- Full end-to-end SSH, native media/download recovery after an RPC restart, Windows hosts and every extension/custom-UI action have not been exercised in this Web acceptance run. Existing unit/regression tests pass; do not describe these as separately browser-verified.
