# Current release readiness — 2026-09-19

This is the release and acceptance evidence index. Live priority, status and
ownership are maintained in the [Delivery Project](https://github.com/users/jihegao/projects/1),
not in a parallel Markdown task list. Historical records prove only their own
source/window, not that the current deployment passes. This 2026-09-19 snapshot
includes the authenticated Chrome/CDP Queue/Mesa acceptance linked below; it does
not extend that result to other accounts, ACL isolation or paid execution.

## Release identity

| Item | Evidence / status |
| --- | --- |
| Source baseline | Local and remote `main`: `c3683695b52fad7dd45d5b19474cd9693d38af02`, checked 2026-09-19 |
| PR #84 | [Merged and deployed](https://github.com/jihegao/riffology-cloud/pull/84), merge `4f564105e11dec7bac9338e770a52c57455279c9`; [Ubuntu CI passed](https://github.com/jihegao/riffology-cloud/actions/runs/35408200559) |
| #84 Gateway deployment record | `530dce72-65a6-4247-b69b-955a432188d2`, 100% at publication; PR records actual Worker byte comparison, static resource hashes and configuration readback |
| #84 execution Worker deployment record | `d5fb4b8a-d2d8-4007-b454-d97816405b22`, 100%; retained through the #90 acceptance release and observed in the authenticated Chrome/CDP trace |
| PR #86 | [Merged Pi developer implementation](https://github.com/jihegao/riffology-cloud/pull/86), merge `dc78b37`; [Ubuntu CI passed](https://github.com/jihegao/riffology-cloud/actions/runs/35421768282). Its historical requests still need provider/admin reconciliation in #87 |
| PR #91 / #90 Gateway | [Auth bootstrap fix merged](https://github.com/jihegao/riffology-cloud/pull/91), merge `c3683695`; Gateway version `ff3fae53-eeb1-4da1-824c-155cf7754268`, deployment `051de36d-4f70-4544-af4d-a3558dec6b6d`, 100%. [Authenticated acceptance](https://github.com/jihegao/riffology-cloud/issues/78#issuecomment-5740806289) records exact Queue/Mesa identities, scoped requests and before/after counts |
| Earlier readback | [Pre-#84 allowlisted snapshot](evidence/invited-queue/release-readback-20260919.json): Gateway `0ca0acc2-fed7-43fe-9fdf-dd19d1e9b9c5`, execution `ead25cd0-74c1-43cd-b604-64dc1b8325d4`; retained as historical evidence only |
| Rollback | Freeze actual active Worker/assets/configuration before a future release; historical `727c40f` is not automatically the current operational rollback target. No database reversal or ledger reset. |

The pre-#84 snapshot had Pi/G5/model-provider/legacy-preview/simulation flags
`false`, no G5 `billingPolicy`, Managed acceptance disabled and schema-2
account-level Managed testing enabled. #84's deployment record says those
policies/gates were preserved. #90's deployment readback again found all 11
execution gates and the money policy disabled; do not extrapolate that result to a
future version.

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
| A: #78/#90 complete; #64/#65 remain | #90 fixed auth bootstrap and #78 is Done. [Authenticated Chrome/CDP acceptance](https://github.com/jihegao/riffology-cloud/issues/78#issuecomment-5740806289) covers exact Queue/Mesa revisions/packages, embedded and independent-page runs, refresh/reopen persistence, method/origin/path trace and unchanged scoped authoritative counts | #65 still carries UI/navigation/error/narrow-screen checks. #64 retains its broader unaccepted Verify scope outside this milestone; the #78 result does not authorize or prove Verify |
| A: #71 | Existing real browser isolation tests retained | Release verifier: current-deployment two-run/two-project storage denial and second authenticated principal; request trace AND scoped authoritative compute counters must agree |
| B: #87, related #46/#37/#68 | #84 bounded fee handling and #86 owner-scoped Pi developer mode merged; authenticated Agent flow not signed off | jihegao: original-call reconciliation, #86 deployment identity check, then authorized model/save/preview/refresh/continue acceptance. Full parent issues remain later candidates |
| C: #35 | Existing publication/copy implementation; honest Queue entry added; no official Queue published | Author + distinct reviewer: ordinary author → baseline/comparison/export → submit → non-author approval → new-user copy and independent run |
| D: invited users | 0 observed participants; no research outcomes claimed | Product owner: 3 participants; all explore, at least 2 independently compare and return in a second visit; record intervention and unknown cost separately |
| #73 | Archived bounded experiment imported; decision `retain-current-runtime` | Research maintainer: preserve frozen negative result; run offline regression only; no new provider allocation |
| #77 follow-up | GitHub issue closed; complete Managed production E2E remains incomplete | Runtime maintainer: retain closed policy; model → native Experiment/Evidence → Preview/Verify → same-Session continuation requires a separate authorized run. Existing late-save/cleanup evidence does not satisfy this chain. |

The #78 closeout covers one authenticated target account and both frozen Queue/Mesa
projects in Chrome/CDP. It includes scoped request and compute-counter evidence, but
does not satisfy #71's second-principal ACL/isolation boundary. Distinct
author/reviewer/test identities remain required where specified.

## Next execution packet

1. Start from the Project's current milestone, [Pi online recovery and core-flow acceptance](https://github.com/jihegao/riffology-cloud/milestone/1).
2. Pi track: [#87](https://github.com/jihegao/riffology-cloud/issues/87), first reconcile original executions and actual deployed identity; do not redevelop #86 or dispatch new calls while unknown execution remains.
3. Acceptance track: #78/#90 are Done; select #71, #83 or #65 next as capacity and dependencies permit. At most one Pi recovery task and one deployed-feature acceptance task are active. Record deployment/model identity, steps, results and remaining gaps on the issue.
4. #35's first official Queue case, #75 email access and #85 skills are the next batch after the core path stabilizes. Other broad architecture/commercial tasks remain candidates; #73 retains its archived decision.
5. Use [the Queue research protocol](invited-queue-research.md) and [acceptance ledger](evidence/invited-queue/acceptance.json) when that phase is reached. Missing observations stay `null`/pending. Existing [local validation](invited-queue-delivery-validation.md) and [branch dispositions](branch-disposition-20260919.md) remain historical references.

CI runs local checks with no cloud/provider credentials. It cannot close A–D by
itself. Do not use closing keywords for issues whose own exit conditions remain open.
