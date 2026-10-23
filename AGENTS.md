# Pi-Agent-Web Working Guidelines

Follow the execution and safety boundaries in the global AGENTS.md. This document adds project-specific workflows only; it does not authorize commits, pushes, or deployments.

## 1. Development and Changes

- Before starting, check the working tree, current branch, relevant code, and callers. Do not overwrite existing changes.
- Reproduce the issue and identify its root cause before editing. Make the smallest complete fix, reuse existing implementations, and avoid unrelated refactoring or features.
- For nontrivial fixes, add a failing regression test first. Cover affected callers, types, tests, and documentation. Add new UI text to all existing locale packages.
- Web operates on sessions through RPC. The independent RPC repository belongs to its maintainers; do not modify its code or rebuild candidates without authorization. Coordinate changes to the protocol, capabilities, cwd, commands, or SSE conventions first.
- When RPC cooperation is needed, explain the problem, Web-side evidence, and requested support. Candidate handoffs must identify the image, versions/capabilities, and fixtures. After acceptance testing, return per-scenario results, evidence paths, and coverage gaps. Determine whether failures belong to Web, RPC, or fixtures before requesting RPC changes; do not treat speculation as a confirmed defect.

## 2. Debugging Sequence

1. Record reproduction steps, expected and actual behavior, browser, selected backend, and affected sessions/directories.
2. Verify the running Web/RPC versions, image digests, and authenticated version response. A `test` tag or page version number is not a substitute for the running image's identity.
3. Explicitly reload the page. Compare browser Network data, Web/RPC logs, and direct HTTP responses to locate the failing layer.
4. Validate one root-cause hypothesis using isolated data, then add a test and fix the cause. On failure, preserve a minimal reproduction, request timeline, and actual responses; do not repeatedly apply unsupported patches.

Use `npm run dev` (port 30141) for development and prefer reusing a healthy service. Run production builds in a separate container to avoid contaminating the development `.next` directory.

## 3. Testing and Acceptance

Choose verification based on the change's impact. Specialized joint acceptance testing is not a prerequisite for every change. Follow the global execution-environment rules.

- For documentation changes, review the content and diff. For code changes, run relevant tests first, adding type checks and lint for changed files as needed.
- Before integrating code into main or making a formal release, run `npm test`, `node_modules/.bin/tsc --noEmit`, and `node_modules/.bin/eslint <changed-files>`. Release images also require a separate production build.
- Add browser tests for UI interactions as needed. Changes affecting RPC interactions, session restoration, or version compatibility require corresponding real-RPC acceptance tests; consult the relevant topic documents for scenarios.
- Unit tests, simulated events, and static rendering verify their respective layers. Do not use them to claim that real end-to-end scenarios passed.
- When upgrading Pi, retain support for existing versions and preserve protocol and required-capability checks. Add only exact versions backed by verification. Do not publish a formal compatibility image before joint acceptance passes against a real candidate.
- Prepare dependencies according to package-lock and Dockerfile. Do not arbitrarily upgrade dependencies to work around environment issues.
- Report checks actually performed, results, and coverage gaps. For joint acceptance, also record both image identities and key requests/events. Timeouts are not passes; distinguish environment or fixture failures from product failures.

## 4. Commits and Releases

- Building, pushing, and deploying are separately authorized stages. Update version tags, `test`, and `latest` only within the user's explicit scope; do not update all tags by default.
- Before releasing, review the diff and existing tags and confirm the version. If already on main, commit directly rather than inventing a merge. Preserve old tags; do not force-push or overwrite old versions.
- Keep the project version synchronized across `release.json`, Dockerfile's `PROJECT_VERSION`, and the arguments and tag in `build-image.sh`. Do not also bump the upstream npm or contract version without a separate reason.
- This fork's default image repository is `registry.aoliyougei.com/aoliyougei/pi-agent-web`. `docs/release.md` describes the upstream npm workflow; do not follow it directly or run `npm run release`.
- After regression checks and a separate production build, commit explicitly selected files and create an annotated Git tag. Push only the specified main branch and that tag; do not use `--tags`.
- Create Docker tags from a verified image ID, push them individually, and inspect the returned digests. Report missing credentials as a blocker; do not switch publication targets.
- Rebuilding after a version update changes the digest. Distinguish the acceptance candidate from the release image, and do not claim that a new digest underwent checks that were not performed on it.
- When deploying mutable tags, verify the pull policy and actual Pod imageID. Redeployment alone does not prove an upgrade occurred.
- At handoff, report the commit, Git/Docker tags and digests, verification results, working-tree status, and whether deployment was changed.

## 5. Documentation Lookup and Maintenance

- Use `docs/README.md` to find relevant topics as needed; reading all documentation is not required for every task.
- Maintain the documentation index as features are added, changed, or removed, and link to currently applicable guidance.
- Preserve version acceptance reports, incident reviews, and release records as historical evidence. State their applicable scope; do not treat them as current general policy.
- Update affected documentation alongside feature changes. Update, archive, or remove index entries for obsolete documents to avoid maintaining conflicting explanations.
- If documentation conflicts with the current implementation, verify the behavior first rather than guessing from historical records.
