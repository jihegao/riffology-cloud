# Invited Queue delivery: validation and boundaries

Date: 2026-09-19. Candidate branch: `codex/invited-queue-delivery`.
Baseline: `727c40f11a5b5e2fd2eebace05e4bd3971955432`.

## Changes

- Imported and reviewed the bounded-billing candidate without changing the original dirty worktree.
- Fixed a newly observed legacy Pi read failure: account-wide Managed testing applies to fresh projects; existing Pi journals retain Pi routing. Explicit project-scoped migration conflicts and pinned Managed routes remain enforced.
- Workspace snapshots now carry an internal `runtimeBackend` hint so Gateway renders the actual route's admission gate. Gateway strips this hint from the public response. No new public endpoint or production policy is introduced.
- Added honest Queue/question entry points. Queue selects only published `queue-research` catalog entries and uses the existing version-selection/copy dialog; no navigation action sends model input or creates a project.
- Imported 48 archived #73 files, preserved 17 checksums, retained negative adoption and incomplete-cost conclusions. Added fflate 0.8.3 without replacing the current dependency graph.
- Added independent offline quality checks, local GitHub CI and delivery/user-acceptance records.

## Checks in this checkout

| Check | Result |
| --- | --- |
| TypeScript | Passed |
| Focused G5 Guard / real local Workerd / authority / freeze / operator / driver | 74 passed, no skip |
| Legacy Pi / Managed routing, Gateway admission and real Workerd journal | 9 passed, no skip |
| Full main UI browser suite, including both research entry paths and narrow viewport | 43 passed, no skip |
| Imported experiment local tests | 29 passed; separate archive-integrity check also passed |
| Offline quality regression | 8 passed |
| Archived evidence checksums | 17/17 verified across 4 bundles |
| Full repository check | Running; final result appended below |
| Real Chrome / Pyodide acceptance | 33/33 passed after asset preparation; local runtime only |
| GitHub-hosted CI | Workflow added; no hosted result claimed until the actual run completes |

Logs are under ignored `.local/` in this isolated worktree. The initial new-entry UI
test exposed an existing `.model-card` selector collision; research cards now have
their own class. The first legacy-route assertion incorrectly used a private
request key omitted by the public view; it now verifies retained status and the
closed admission fence. Both failures and successful reruns remain in task output.

The first standalone Pyodide launch failed before execution because this fresh
worktree had no generated static index. Pinned public upstream assets were copied
from the existing cache and hash-checked by the normal preparer. Adding fflate
changes package-lock, which is part of the trusted runtime identity. Therefore
`prepare-assets.mjs --update-manifest` and `execution/materialize.mjs --update-index`
regenerated the reviewed profile/delivery/static-index metadata. The Worker/frame
source and isolation contract were not relaxed. A future deployment will require
the normal same-Revision package rebuild and signed-in migration acceptance;
generated metadata is not a production release.

Workers review used the [official best-practice reference](https://developers.cloudflare.com/workers/best-practices/workers-best-practices/),
retrieved Workers types 5.20260918.1, and the repository's locked types/configuration.
No production bindings, secrets, namespaces, ledger migrations or prices changed.

The first full check passed M0/M1/M2, then timed out in two real-Workerd M3
suites under CPU-count-based file concurrency. Gateway assets subsequently passed
in 5.3 seconds with stage diagnostics; its 30-second deadline was retained. M0–M3
now run at two concurrent files, and the Gateway test uses the portable Chrome
channel (or an explicit CHROMIUM_PATH). CI prepares and validates pinned public
assets before running the unchanged assertions. The interrupted first-run log is
retained separately; it is not reported as a pass. Both affected suites passed
in isolation (Gateway assets 1/1; historical Workspace reads 7/7). The next full
run exposed an existing UI test race: receiving the last history request does
not mean its response has rendered. That test now waits for the actual retained
reply before asserting all 2048 events, exactly 12 reads per visit and zero
mutations. It passed in isolation; the final full run includes this correction. A later M0 run also hit a 25ms
fixture deadline while checking replay rejection under the default concurrency;
all 21 proxy tests passed in isolation. The two-file concurrency limit is applied
consistently to M0–M3, keeping every timeout and assertion unchanged.

## Fresh online observation and remaining work

Safari signed in through an existing Google account. The current official model
catalog was empty. The historical G4 Queue workspace opened but displayed the
legacy-runtime conflict and kept Model loading; this motivated the candidate fix.
Browser control subsequently reported a user app change, and no further live
interaction was attempted. No auth state was exported or committed.

This does not pass the Queue/Mesa playback, parameter, refresh, independent-page,
second-principal or zero-compute matrix. Fresh authenticated GETs confirmed current Gateway and browser-execution versions
and allowlisted configuration (see the release readback). The private historical
budget ledger and authoritative compute counters were not read. No deployment, merge, gate change,
new model call, official publication or participant research run was performed.
All A–D exit gates therefore remain pending; see [release readiness](release-readiness.md).
