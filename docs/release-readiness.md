# Current release readiness — 2026-09-19

This is the release and acceptance evidence index. Live priority, status and
ownership are maintained in the [Delivery Project](https://github.com/users/jihegao/projects/1),
not in a parallel Markdown task list. Historical records prove only their own
source/window, not that the current deployment passes. This 2026-09-19 planning
refresh checked GitHub PRs and repository evidence; it did not run authenticated
production acceptance or re-read Cloudflare's active deployment.

## Release identity

| Item | Evidence / status |
| --- | --- |
| Source baseline | Local and remote `main`: `dc78b37e6468ca2ba136488db86c22433925b3ee`, checked 2026-09-19 |
| PR #84 | [Merged and deployed](https://github.com/jihegao/riffology-cloud/pull/84), merge `4f564105e11dec7bac9338e770a52c57455279c9`; [Ubuntu CI passed](https://github.com/jihegao/riffology-cloud/actions/runs/35408200559) |
| #84 Gateway deployment record | `530dce72-65a6-4247-b69b-955a432188d2`, 100% at publication; PR records actual Worker byte comparison, static resource hashes and configuration readback |
| #84 execution Worker deployment record | `d5fb4b8a-d2d8-4007-b454-d97816405b22`, 100% at publication; not asserted as the active version after #86 |
| PR #86 | [Merged Pi developer implementation](https://github.com/jihegao/riffology-cloud/pull/86), merge `dc78b37`; [Ubuntu CI passed](https://github.com/jihegao/riffology-cloud/actions/runs/35421768282). Deployment identity/readback still needs reconciliation in #87 |
| Earlier readback | [Pre-#84 allowlisted snapshot](evidence/invited-queue/release-readback-20260919.json): Gateway `0ca0acc2-fed7-43fe-9fdf-dd19d1e9b9c5`, execution `ead25cd0-74c1-43cd-b604-64dc1b8325d4`; retained as historical evidence only |
| Rollback | Freeze actual active Worker/assets/configuration before a future release; historical `727c40f` is not automatically the current operational rollback target. No database reversal or ledger reset. |

The pre-#84 snapshot had Pi/G5/model-provider/legacy-preview/simulation flags
`false`, no G5 `billingPolicy`, Managed acceptance disabled and schema-2
account-level Managed testing enabled. #84's deployment record says those
policies/gates were preserved. Do not extrapolate this snapshot to a later version.

[Pi developer mode](pi-developer-mode.md) and #86 record four original G5
unknown/pending calls without terminal evidence and two generic
provider-failure/pending calls. Agent execution must remain blocked until the
original identities have trustworthy terminal/stop/resource evidence. Complete
execution with missing usage is a different, fee-pending state; never clear old
reservations or call unknown fees zero. The existing developer mode uses an
owner-scoped fee-observation policy, not an invented new credit allowance.
The source manifest is a digest, not a Git commit; metadata or static assets
alone do not prove authenticated acceptance or zero cloud execution.

## Delivery gates and accountable work

| Batch / issues | Current state | Owner / exact remaining exit condition |
| --- | --- | --- |
| A: #83 | Code already on remote main; [issue record corrected](https://github.com/jihegao/riffology-cloud/issues/83#issuecomment-5736868137); historical aa interaction proof retained | Release maintainer: complete current-version refresh, narrow viewport, stale/current version and failure-state matrix before closure |
| A: #78/#64/#65 | #84 fixes legacy Pi reads and retains old runtime assets. [Pi guide](pi-developer-mode.md) records user-confirmed Queue/Mesa runs, parameter effects and refresh persistence; the earlier [Queue failure](https://github.com/jihegao/riffology-cloud/issues/78#issuecomment-5736868410) remains historical evidence | jihegao: #78 carries current-deployment Queue + Mesa playback/seed/refresh/independent-page/zero-cloud-execution acceptance; #65 carries UI/navigation/error/narrow-screen checks. #64 retains its broader unaccepted Verify scope outside this milestone |
| A: #71 | Existing real browser isolation tests retained | Release verifier: current-deployment two-run/two-project storage denial and second authenticated principal; request trace AND scoped authoritative compute counters must agree |
| B: #87, related #46/#37/#68 | #84 bounded fee handling and #86 owner-scoped Pi developer mode merged; authenticated Agent flow not signed off | jihegao: original-call reconciliation, #86 deployment identity check, then authorized model/save/preview/refresh/continue acceptance. Full parent issues remain later candidates |
| C: #35 | Existing publication/copy implementation; honest Queue entry added; no official Queue published | Author + distinct reviewer: ordinary author → baseline/comparison/export → submit → non-author approval → new-user copy and independent run |
| D: invited users | 0 observed participants; no research outcomes claimed | Product owner: 3 participants; all explore, at least 2 independently compare and return in a second visit; record intervention and unknown cost separately |
| #73 | Archived bounded experiment imported; decision `retain-current-runtime` | Research maintainer: preserve frozen negative result; run offline regression only; no new provider allocation |
| #77 follow-up | GitHub issue closed; complete Managed production E2E remains incomplete | Runtime maintainer: retain closed policy; model → native Experiment/Evidence → Preview/Verify → same-Session continuation requires a separate authorized run. Existing late-save/cleanup evidence does not satisfy this chain. |

Earlier fresh browser observation covered one account and Queue navigation.
Later user-reported preview success is partial evidence, not a full current-version
matrix. This planning refresh adds no browser, compute-counter or second-user ACL
acceptance. Current milestone acceptance owners are assigned to jihegao in GitHub;
distinct author/reviewer/test identities remain required where specified.

## Next execution packet

1. Start from the Project's current milestone, [Pi online recovery and core-flow acceptance](https://github.com/jihegao/riffology-cloud/milestone/1).
2. Pi track: [#87](https://github.com/jihegao/riffology-cloud/issues/87), first reconcile original executions and actual deployed identity; do not redevelop #86 or dispatch new calls while unknown execution remains.
3. Acceptance track: select #78 first, then #71/#83/#65 as capacity and dependencies permit. At most one Pi recovery task and one deployed-feature acceptance task are active. Record deployment/model identity, steps, results and remaining gaps on the issue.
4. #35's first official Queue case, #75 email access and #85 skills are the next batch after the core path stabilizes. Other broad architecture/commercial tasks remain candidates; #73 retains its archived decision.
5. Use [the Queue research protocol](invited-queue-research.md) and [acceptance ledger](evidence/invited-queue/acceptance.json) when that phase is reached. Missing observations stay `null`/pending. Existing [local validation](invited-queue-delivery-validation.md) and [branch dispositions](branch-disposition-20260919.md) remain historical references.

CI runs local checks with no cloud/provider credentials. It cannot close A–D by
itself. Do not use closing keywords for issues whose own exit conditions remain open.
