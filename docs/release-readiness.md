# Current release readiness — 2026-09-20

This is the release and acceptance evidence index. Live priority, status and
ownership are maintained in the [Delivery Project](https://github.com/users/jihegao/projects/1),
not in a parallel Markdown task list. Historical records prove only their own
source/window, not that the current deployment passes. This 2026-09-20 snapshot
includes the authenticated Chrome/CDP Queue/Mesa acceptance and #87's bounded
paid Pi acceptance linked below. Neither proves other accounts, full ACL
isolation or standing Private Beta capacity. GitHub and source were checked for
this update; live Worker settings were re-read on 2026-09-20: version `ef30dd39-4ea0-4476-888c-8fdd1b964ecd`, all execution gates closed.

## Private Beta definition and standing capacity

**Riffology Cloud Private Beta — 邀请制内测版**

> 面向受邀用户的受控内测版本。支持 Pi 驱动的 Python 建模、保存和本地预览；不包含生产级 SLA、权威云端实验或公开商业服务。容量在预算和安全门限内持续开放。

This is the product definition and intended operating policy. Standing capacity
is not yet signed off or declared open. [#104: 邀请制内测运行与常态容量](https://github.com/jihegao/riffology-cloud/issues/104)
owns the frozen operating packet, implementation gaps, stop conditions and exit
criteria. #87 stays CLOSED / Done; its expired window must not be reopened or
extended. The user confirmed immediate work; #104 is P0 / In progress. Current priority,
status, milestone and owner remain in the Delivery Project.

| Boundary | Private Beta contract |
| --- | --- |
| Supported path | Pi request → edit Python → save Revision → Browser Preview → change parameters → refresh/leave and continue. Preview is always local/unverified |
| Outside the commitment | Verified Experiment/Evidence, public signup, commercial SLA, Credits/payments and high user concurrency |
| Admission and hard limits | Accepted ordinary invitation plus active user/personal tenant/owner membership; owned personal projects inherit admission with no additional count cap. One active Turn per user across projects; global two (native Pi remains one). UTC daily 80 calls/US$2 per user, 240 calls/US$5 global; cumulative US$20. See the confirmed packet in #104 |
| Standing operation | Pi/M2 capacity remains available within approved budgets and safety limits; no per-session #87 acceptance window. Day changes and policy/project changes never erase unknown records or reservations |
| Execution safety | No automatic retry or provider fallback. Unknown execution immediately isolates the original run and pauses affected admission; use the global kill switch when scope is unknown or global controls fail |
| Operations | Capacity monitoring, fee alerts and named response owner; verify runtime/tool/container release after each terminal Turn. Unconfirmed release keeps capacity occupied |
| Historical billing | #101 independently reconciles the seven isolated historical calls, preserving their usage/fees/reservations. Historical fee uncertainty does not block normal Beta; new execution risk still pauses affected capacity. New pending fees retain reservations within explicit caps |
| Gates | Only required Pi/M2 routes may open for the allowlist: M2_TURNS_ENABLED, M2_MODEL_PROVIDER_ENABLED and PRODUCTION_MODEL_ENABLED. G5 admission, M3 cloud Preview/WS/Service and M4 Simulation remain closed; local Browser Preview does not require them |

The legacy [Pi policy parser](../services/model-budget/pi-developer-policy.ts)
remains unchanged for #87. The [standing policy](../services/model-budget/private-beta-policy.ts)
and [global capacity authority](../services/model-budget/private-beta-capacity.ts)
add persistent daily/cumulative reservation limits and cross-project occupancy;
the existing per-tenant Pi ledger remains the dispatch/terminal authority.
Implementation evidence and operating steps are in [the operating note](private-beta-operations.md).
Current actual invited identities (#92) and second-principal isolation (#71),
closed-gate deployment, paid acceptance and seven-day observation remain separate
from local tests; none is inferred from the version name.

## Release identity

| Item | Evidence / status |
| --- | --- |
| Source baseline | Remote `main`: `3664f9f58419882470c165483d45c23f6f743569`, checked 2026-09-20; [post-#103 main CI passed](https://github.com/jihegao/riffology-cloud/actions/runs/35455769710). Application implementation remains #102 (`162c8917`); #103 adds acceptance documentation |
| PR #84 | [Merged and deployed](https://github.com/jihegao/riffology-cloud/pull/84), merge `4f564105e11dec7bac9338e770a52c57455279c9`; [Ubuntu CI passed](https://github.com/jihegao/riffology-cloud/actions/runs/35408200559) |
| #84 Gateway deployment record | `530dce72-65a6-4247-b69b-955a432188d2`, 100% at publication; PR records actual Worker byte comparison, static resource hashes and configuration readback |
| #84 execution Worker deployment record | `d5fb4b8a-d2d8-4007-b454-d97816405b22`, 100%; retained through the #90 acceptance release and observed in the authenticated Chrome/CDP trace |
| PR #86 | [Merged Pi developer implementation](https://github.com/jihegao/riffology-cloud/pull/86), merge `dc78b37`; [Ubuntu CI passed](https://github.com/jihegao/riffology-cloud/actions/runs/35421768282). #87 completed execution-isolation and core-flow acceptance; historical provider usage/billing is independent P1 #101 |
| PR #97–#100 | Merged #87 blocker inventory, exact release-hold reconciliation and private request correlation. [The latest #87 record](https://github.com/jihegao/riffology-cloud/issues/87#issuecomment-5741935018) identifies deployed Gateway version `f4da845a-96a5-42b8-bbb3-21fc18e44bcb`, exact merged source `5ac8fa5`, preserved bindings and closed execution gates. These changes expose and reconcile existing records; they do not retry, settle or replay them |
| PR #102 / #87 | [Execution isolation merged](https://github.com/jihegao/riffology-cloud/pull/102), merge `162c8917102333b2f4395abf8e07cfd5ea4cf98f`; exact append-only HMAC proof, runtime tombstone and accept/fence serialization. Production acceptance ended on Gateway version `ef30dd39-4ea0-4476-888c-8fdd1b964ecd`, 100%, with all execution gates closed and 89 bindings preserved |
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
unknown/pending calls without provider terminal evidence and two generic
provider-failure/pending calls. [The exact reconciliation](https://github.com/jihegao/riffology-cloud/issues/87#issuecomment-5741725933)
subsequently proved all six matching ProductTurnRuntime actors terminal/released
and cleared the six exact Workspace release holds; their request-level usage and
fees remain pending. The separate legacy OpenCode Go call now has the same
Workspace-authoritative `runtime-released` proof. All seven historical records
are execution-isolated; their provider usage, fees and original reservations
remain unchanged and pending.

#87's P0 gate was execution isolation, not supplier invoice settlement. The
seven proofs and bounded core-flow acceptance are now complete. Missing
historical usage stays in independent P1 #101 and did not block acceptance.
Never clear old reservations,
call unknown fees zero, replay a request, or use a new project, policy or window
to bypass either record. The existing developer mode uses an owner-scoped
fee-observation policy, not an invented new credit allowance.
The source manifest is a digest, not a Git commit; metadata or static assets
alone do not prove authenticated acceptance or zero cloud execution.

## Delivery gates and accountable work

| Batch / issues | Current state | Owner / exact remaining exit condition |
| --- | --- | --- |
| A: #83 | Code already on remote main; [issue record corrected](https://github.com/jihegao/riffology-cloud/issues/83#issuecomment-5736868137); historical aa interaction proof retained | Release maintainer: complete current-version refresh, narrow viewport, stale/current version and failure-state matrix before closure |
| A: #78/#90 complete; #64/#65 remain | #90 fixed auth bootstrap and #78 is Done. [Authenticated Chrome/CDP acceptance](https://github.com/jihegao/riffology-cloud/issues/78#issuecomment-5740806289) covers exact Queue/Mesa revisions/packages, embedded and independent-page runs, refresh/reopen persistence, method/origin/path trace and unchanged scoped authoritative counts | #65 still carries UI/navigation/error/narrow-screen checks. #64 retains its broader unaccepted Verify scope outside this milestone; the #78 result does not authorize or prove Verify |
| A: #71 | Existing real browser isolation tests retained | Release verifier: current-deployment two-run/two-project storage denial and second authenticated principal; request trace AND scoped authoritative compute counters must agree |
| B: #87 complete; related #46/#37/#68 remain | PR #102 merged; 7/7 historical calls have exact execution-isolation proof. One bounded authenticated Turn created and saved a Python Queue model and Revision, produced a runnable Preview, retained modified parameters after refresh, and ended quiet/released. The 8/8 provider-call ceiling was reached without retry or fallback, so no second Turn was submitted | [#87 CLOSED / Done](https://github.com/jihegao/riffology-cloud/issues/87#issuecomment-5743576761), with [#103 evidence merged](https://github.com/jihegao/riffology-cloud/pull/103). Historical per-request usage/billing remains independent P1 #101; Preview is local/unverified. Standing capacity is #104; full parent issues remain later candidates |
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
2. Pi track: [#87](https://github.com/jihegao/riffology-cloud/issues/87) stays closed. Prepare [#104](https://github.com/jihegao/riffology-cloud/issues/104)'s standing Private Beta policy and actual limits; open only after its implementation, scope-specific checks and operating packet are ready. The expired project-specific acceptance window is not a standing production policy.
3. Historical provider usage and fee reconciliation continues only in P1 #101. Do not retry, settle, refund or rewrite the seven original records.
4. Acceptance track: #78/#90/#87 are Done; select one of #71/#92/#83/#65 as capacity and dependencies permit, prioritizing the invited identity/isolation evidence needed by #104. At most one Pi standing-capacity task and one deployed-feature acceptance task are active. Record deployment/model identity, steps, results and remaining gaps on the issue.
5. #35's first official Queue case, #75 email access and #85 skills are the next batch after the core path stabilizes. Other broad architecture/commercial tasks remain candidates; #73 retains its archived decision.
6. Use [the Queue research protocol](invited-queue-research.md) and [acceptance ledger](evidence/invited-queue/acceptance.json) when that phase is reached. Missing observations stay `null`/pending. Existing [local validation](invited-queue-delivery-validation.md) and [branch dispositions](branch-disposition-20260919.md) remain historical references.

CI runs local checks with no cloud/provider credentials. It cannot close A–D by
itself. Do not use closing keywords for issues whose own exit conditions remain open.
