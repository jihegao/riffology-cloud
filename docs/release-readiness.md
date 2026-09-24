# Current release readiness — 2026-09-24

## 2026-09-24 Private Beta draft recovery and capacity diagnosis

[PR #138](https://github.com/jihegao/riffology-cloud/pull/138) implements
[#137](https://github.com/jihegao/riffology-cloud/issues/137)'s safe draft
recovery path. A pending Private Beta request can be withdrawn only after its
original Workspace confirms no matching Turn; a durable fence blocks a late POST
under the original idempotency key. The browser then restores the same draft for
editing. A caller-scoped capacity read distinguishes admission, running,
release waiting and isolated states without exposing other users' identities.
Unknown or accepted requests retain the original recovery identity.

Source `8c3cf69fce35c0cb1d5a93e82471c81973462cc4` is deployed as Gateway
version `9c7b7298-7743-43b4-84f2-c7145bf9f27b`, deployment
`388a54f5-b172-4f5e-8a2a-98154de596cc`, at 100%. Independent API readback
matched all 91 frozen bindings and runtime configuration; downloaded Worker
bytes matched the release bundle and all 17 checked public assets matched source.
The [CI run](https://github.com/jihegao/riffology-cloud/actions/runs/36004367509)
and complete local checks passed with zero failures (UI 21, M1 277, M2 840,
M3 962 passed and 10 conditional skips).

Authenticated read-only Data Studio queries identified the affected user's
original bound slot in the reported Workspace as **quarantined**, with seven
observed calls and a release-unconfirmed alert. Before and after the authenticated
browser recovery, the capacity ledger held one quarantined slot, 18 released
slots, 80 observed calls and 1,207,105,250 nanodollars of conservative
reservation. The original Safari tab showed `review-required`; **Edit draft**
restored the unchanged text to an editable input.

After explicit user authorization on 2026-09-24, the original Workspace's
read-only release method confirmed the bound Turn was terminal and released,
with no resource wait or native release guard. The capacity snapshot showed
only one quarantined slot and 80 observed calls, with no unresolved calls.
The existing guarded `resume()` method released that slot and wrote a `resume`
audit entry at 13:56:38 UTC. Independent Data Studio SELECTs then confirmed
19 released slots, zero occupied/quarantined slots, and the same 80 observed
calls and 1,207,105,250 nanodollar conservative reservation. The original
authenticated Safari Workspace retained the editable draft and visible Send
button after refresh. No Send/Retry, new Turn, provider or tool request was
submitted, so paid execution acceptance remains separate under #104. The
Preview `python-stdlib/v1` incompatibility is separate.

[Release and acceptance evidence](evidence/releases/beta-busy-composer-20260924.json).

## 2026-09-23 rejected-session capacity repair

[PR #135](https://github.com/jihegao/riffology-cloud/pull/135) repairs
[#134](https://github.com/jihegao/riffology-cloud/issues/134): an old Session
rejected after an auth-version change had already reserved the user's Beta slot.
Session/input checks now precede admission. The original Workspace must prove an
immutable Session mismatch, no matching Turn and a quiet journal; the capacity
record must have no bound Turn or calls before it can be returned. The original
slot and alerts remain, with a new release audit.

Gateway version `a2770d8a-5873-4d51-8189-3cf43b530f23` is deployed at 100%. Independent readback
confirmed all 91 bindings, runtime/container configuration, budgets and gates
were preserved, and downloaded Worker bytes match the release bundle.
The uploader omitted the frozen observability setting; it was restored from the
pre-release snapshot and independently verified before acceptance. All 17 public
assets checked match source bytes.
CI, local M2 838/838, UI 21/21 and TypeScript passed.

Authenticated read-only acceptance confirmed the original unbound slot was
automatically released and total occupied/quarantined slots became 0/0. The
73 observed Beta calls and 1,122,985,350 nanodollar conservative reservation
were unchanged. The original Workspace retained nextSequence=648 and no active
Turn or resource/release/recovery hold; the original draft was preserved after
refresh. No request was resubmitted, and no model/tool or paid execution
acceptance is claimed. #104's observation scope remains separate.

[Release and acceptance evidence](evidence/releases/beta-rejected-session-20260923.json).
The UI release record below is the preceding deployment.


## 2026-09-23 UI release and independent readback

PRs #130, #131, #132 and #133 are merged in dependency order. Before merge, all
10 inline review findings were addressed, including durable message receipts,
storage failures, overlapping refreshes, the real Verify POST/GET contract and
locale binding lifetime. [Final code CI](https://github.com/jihegao/riffology-cloud/actions/runs/35759421134)
and the complete relevant local suites passed (M1 275; M3 962 with 10 conditional
skips; check:ui 21; TypeScript).

Application source `1c643fceed1e6b62c3605647a99750ac1a9b3637` is deployed as Gateway version
`cb6935dc-dfed-4d62-8e88-8aa82215ff59`, deployment `6a54ca89-bd48-4ddc-8fac-8ae35d834930`, at 100%.
The actual Catalog received additive migration `0011_user_locale_preferences.sql`.
Independent API readback matched all 91 existing bindings, runtime/container
configuration, gates, budgets and secrets metadata to the frozen prior version.
Downloaded Worker bytes match the release bundle SHA256
`c866085214de1fc0f4dc22ee7a41dbb1b366a3f73bee8621b77f8b209602fb45`. The Browser Execution Worker was not changed.

All 17 checked public HTML/JS resources match the source bytes. A fresh anonymous
browser passed Chinese/English switching, refresh persistence, the admin shell
and 390px layout without horizontal overflow or script errors; its captured
application requests were GET-only. This is public/static verification, not
authenticated user or paid execution acceptance. #126/#128/#129 remain Acceptance;
#65/#83 and #104 retain their separate outstanding acceptance/observation scope.

[Machine-readable release evidence](evidence/releases/ui-20260923.json) records
source, PRs, CI, deployment, hashes and verification limits. The following dated
records preserve earlier implementation and acceptance snapshots.


This is the release and acceptance evidence index. Live priority, status and
ownership are maintained in the [Delivery Project](https://github.com/users/jihegao/projects/1),
not in a parallel Markdown task list. Historical records prove only their own
source/window, not that the current deployment passes. The earlier 2026-09-21 snapshot
includes the authenticated Chrome/CDP Queue/Mesa acceptance, #71's current-version
browser-isolation acceptance, #87's bounded paid Pi acceptance and #92's real
invitee revocation/audit acceptance and revoked-session migration linked below.
They do not complete the
seven-day standing-capacity observation. GitHub, source and live Worker settings
were re-read on 2026-09-21: Gateway version
`2175756e-615d-4525-883b-34395a5bc50e` serves 100%; only the three approved
Pi/M2 gates are open, while G5 and M3/M4 remain closed.

## 2026-09-22 local delivery evidence

[#65](https://github.com/jihegao/riffology-cloud/issues/65#issuecomment-5774124958)
and [#83](https://github.com/jihegao/riffology-cloud/issues/83#issuecomment-5777186998)
record the local layout (23 checks) and preview panel (21 checks) results. Their
remaining authenticated production matrix is separate from those fixtures.
The #65 readback identified Gateway version `2175756e-615d-4525-883b-34395a5bc50e`;
this is not evidence that the changes described below are deployed.

[#128 A](https://github.com/jihegao/riffology-cloud/issues/128) adds the shared
Chinese/English shell, optional account locale metadata, display formatting and
incremental copy checks. [The i18n contract](i18n.md) lists the exact foundation
coverage and the full product-copy migration below. Locale switching retains the
current Workspace nodes, draft, Session, Preview and unresolved submission intent;
fixture checks assert the only added write is the account preference PUT.
The account read degrades without breaking identity bootstrap, while writes
recheck account activity and auth version in SQL after admission.

Local validation covers the real Gateway asset graph, ordinary/admin/Workspace
browser fixtures, preference races, storage denial, post-admission revocation,
additive migration and the existing M0–M3 regression suites. Exact command results
and CI are recorded in the linked Issue/PR. This foundation requires additive
migration `0011_user_locale_preferences.sql` before publishing the new assets.
It has not been deployed or accepted with a current production account; no new
Turn, paid provider call, experiment, gate or historical billing mutation was
performed for this delivery. A alone does not satisfy or close the full #128.

[#126](https://github.com/jihegao/riffology-cloud/issues/126) adds composer progress
through Session creation, Turn submission and confirmed message visibility. The
accepted Turn ID remains in the recovery intent until the matching message is
rendered; late replies cannot unlock another Workspace. The local UI checks cover
46 web cases, 25 Workspace layout cases and 3 independent lifecycle cases,
including rejected browser storage and held receipts with no duplicate POST.
This change depends on the #128 A foundation and has not been deployed or
accepted against a production submission.

[#129](https://github.com/jihegao/riffology-cloud/issues/129) orders the canvas as
Model / Preview / Runs / Inspect while retaining Preview as the initial tab.
The existing experiment form now lives in Runs. Preview hands off a frozen
Revision, package identity, parameters and seed without a POST; Runs requires
explicit confirmation and preserves the original request identity until its
matching receipt is known. Standalone Preview returns to Workspace Runs with
the frozen draft. Only the current Workspace preview response enables Verify;
loading, missing availability and failed restoration leave it unavailable.
Local fixtures cover handoff, pending-request recovery, storage failures,
Workspace navigation and closed gates. This is local implementation evidence,
not deployment or authenticated server-experiment acceptance. No live experiment
or gate change is part of this delivery.

[#128 B](https://github.com/jihegao/riffology-cloud/issues/128) extends the foundation
to all product panels, dynamic notices, errors and accessibility labels, with
887 matching keys per locale. Explicit bindings retain form values, focus, user
content, iframe identity and unresolved request keys during language changes.
The copy guard removes JavaScript CJK exceptions and inventories the remaining
technical English literals. Local browser checks exercise both languages and
narrow-screen layout; exact final suite counts and CI are recorded in the Issue/PR.
This implementation is stacked after #129 and requires the same additive locale
migration. It is not merged, deployed or authenticated production acceptance.

## Private Beta definition and standing capacity

**Riffology Cloud Private Beta — 邀请制内测版**

> 面向受邀用户的受控内测版本。支持 Pi 驱动的 Python 建模、保存和本地预览；不包含生产级 SLA、权威云端实验或公开商业服务。容量在预算和安全门限内持续开放。

This is the product definition and operating contract. The implementation in
[PR #105](https://github.com/jihegao/riffology-cloud/pull/105) is merged and deployed;
[#104](https://github.com/jihegao/riffology-cloud/issues/104) owns the frozen packet,
current open/paused state, acceptance evidence, stop conditions and exit criteria.
The seven-day observation is not complete. #87 stays CLOSED / Done; its expired
window must not be reopened or extended. Current priority, status, milestone and
owner remain in the Delivery Project.

The 2026-09-20 release includes the new-tenant historical-ledger check in
[PR #109](https://github.com/jihegao/riffology-cloud/pull/109) and the independent G5
alarm stop in [PR #107](https://github.com/jihegao/riffology-cloud/pull/107).
Both PRs passed full CI; their combined M2 suite passed 834 tests. The closed-gate
release `2d216a3a-4d26-4646-a5fd-ae598f474167` was independently read back with
unchanged bindings and Worker SHA256
`c7fe8321ec59022de05a2ca93968cf63706f892cd277fb495b64f799e5b8e226`, matching the build.
The first invited submission before #109 was rejected before admission: original
Workspace and global Beta capacity both showed zero Turns/calls/reservations.
It is not paid-execution acceptance. The deployment, continuous alarm observation
and subsequent original-project acceptance are recorded in #104 and
[#106](https://github.com/jihegao/riffology-cloud/issues/106); source/CI evidence
alone does not establish them.

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
Current invited-project admission and its reversible access revocation (#92) are
accepted against a real invitee. Paid acceptance and the seven-day observation
remain separate from local tests; none is inferred from the version name. #71's
second-principal/browser-isolation boundary is independently accepted, without
promoting local Preview to Evidence.

## Release identity

| Item | Evidence / status |
| --- | --- |
| Source baseline | Deployed application source: `1c643fceed1e6b62c3605647a99750ac1a9b3637` from the merged #130–#133 stack, checked 2026-09-23. Final code CI and independent Worker/assets readback passed; authenticated acceptance remains separate |
| PR #84 | [Merged and deployed](https://github.com/jihegao/riffology-cloud/pull/84), merge `4f564105e11dec7bac9338e770a52c57455279c9`; [Ubuntu CI passed](https://github.com/jihegao/riffology-cloud/actions/runs/35408200559) |
| #84 Gateway deployment record | `530dce72-65a6-4247-b69b-955a432188d2`, 100% at publication; PR records actual Worker byte comparison, static resource hashes and configuration readback |
| #84 execution Worker deployment record | `d5fb4b8a-d2d8-4007-b454-d97816405b22`, 100%; retained through the #90 acceptance release and observed in the authenticated Chrome/CDP trace |
| PR #86 | [Merged Pi developer implementation](https://github.com/jihegao/riffology-cloud/pull/86), merge `dc78b37`; [Ubuntu CI passed](https://github.com/jihegao/riffology-cloud/actions/runs/35421768282). #87 completed execution-isolation and core-flow acceptance; historical provider usage/billing is independent P1 #101 |
| PR #97–#100 | Merged #87 blocker inventory, exact release-hold reconciliation and private request correlation. [The latest #87 record](https://github.com/jihegao/riffology-cloud/issues/87#issuecomment-5741935018) identifies deployed Gateway version `f4da845a-96a5-42b8-bbb3-21fc18e44bcb`, exact merged source `5ac8fa5`, preserved bindings and closed execution gates. These changes expose and reconcile existing records; they do not retry, settle or replay them |
| PR #102 / #87 | [Execution isolation merged](https://github.com/jihegao/riffology-cloud/pull/102), merge `162c8917102333b2f4395abf8e07cfd5ea4cf98f`; exact append-only HMAC proof, runtime tombstone and accept/fence serialization. Production acceptance ended on Gateway version `ef30dd39-4ea0-4476-888c-8fdd1b964ecd`, 100%, with all execution gates closed and 89 bindings preserved |
| PR #91 / #90 Gateway | [Auth bootstrap fix merged](https://github.com/jihegao/riffology-cloud/pull/91), merge `c3683695`; Gateway version `ff3fae53-eeb1-4da1-824c-155cf7754268`, deployment `051de36d-4f70-4544-af4d-a3558dec6b6d`, 100%. [Authenticated acceptance](https://github.com/jihegao/riffology-cloud/issues/78#issuecomment-5740806289) records exact Queue/Mesa identities, scoped requests and before/after counts |
| Current Private Beta Gateway | Source `1c643fceed1e6b62c3605647a99750ac1a9b3637`; deployment `6a54ca89-bd48-4ddc-8fac-8ae35d834930`, 100% version `cb6935dc-dfed-4d62-8e88-8aa82215ff59`, 91 bindings preserved. Only additive locale schema plus Gateway code/assets changed; frozen Pi/M2 capacity policy and closed G5/M3/M4 gates are unchanged |
| #71 browser isolation | [Current production acceptance](https://github.com/jihegao/riffology-cloud/issues/71#issuecomment-5750074199) covers two projects, Queue/Mesa, opaque storage denial, BroadcastChannel positive/negative controls, cancel/refresh/late-message behavior, a second authenticated principal, GET-only request trace and unchanged scoped compute counts. Browser Execution remains 100% version `d5fb4b8a-d2d8-4007-b454-d97816405b22` |
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
| A: #71 complete | [Current production acceptance](https://github.com/jihegao/riffology-cloud/issues/71#issuecomment-5750074199) passed for two projects and a second authenticated principal; same-frame BroadcastChannel positive controls worked while cross-project delivery stayed empty. Current immutable runtime hashes matched a 37/37 real Chrome/Pyodide suite | [#71 CLOSED / Done](https://github.com/jihegao/riffology-cloud/issues/71). Preview remains local/unverified; this does not accept #64 Verify |
| A: #92 complete | [PR #119](https://github.com/jihegao/riffology-cloud/pull/119) adds reversible accepted-invite access revocation without mutating invitation acceptance, tenant, membership or projects. [PR #124](https://github.com/jihegao/riffology-cloud/pull/124) keeps the pre-revocation Session read-only and adds an explicit draft-preserving migration to a new Session. On the current deployment the real invitee refreshed into `Session 2` with the original draft editable and Send enabled; no Turn or provider/model request was submitted | [#92](https://github.com/jihegao/riffology-cloud/issues/92) owns the admission/revocation evidence; [#123](https://github.com/jihegao/riffology-cloud/issues/123) owns the post-restore conversation defect and production acceptance. Paired invitation/user audit events share request IDs; user `auth_version` advanced while the accepted invitation and four projects remained intact. Broader tenant/member/deletion lifecycle remains #93 |
| B: #87 complete; related #46/#37/#68 remain | PR #102 merged; 7/7 historical calls have exact execution-isolation proof. One bounded authenticated Turn created and saved a Python Queue model and Revision, produced a runnable Preview, retained modified parameters after refresh, and ended quiet/released. The 8/8 provider-call ceiling was reached without retry or fallback, so no second Turn was submitted | [#87 CLOSED / Done](https://github.com/jihegao/riffology-cloud/issues/87#issuecomment-5743576761), with [#103 evidence merged](https://github.com/jihegao/riffology-cloud/pull/103). Historical per-request usage/billing remains independent P1 #101; Preview is local/unverified. Standing capacity is #104; full parent issues remain later candidates |
| C: #35 | Existing publication/copy implementation; honest Queue entry added; no official Queue published | Author + distinct reviewer: ordinary author → baseline/comparison/export → submit → non-author approval → new-user copy and independent run |
| D: invited users | 0 observed participants; no research outcomes claimed | Product owner: 3 participants; all explore, at least 2 independently compare and return in a second visit; record intervention and unknown cost separately |
| #73 | Archived bounded experiment imported; decision `retain-current-runtime` | Research maintainer: preserve frozen negative result; run offline regression only; no new provider allocation |
| #77 follow-up | GitHub issue closed; complete Managed production E2E remains incomplete | Runtime maintainer: retain closed policy; model → native Experiment/Evidence → Preview/Verify → same-Session continuation requires a separate authorized run. Existing late-save/cleanup evidence does not satisfy this chain. |

The #78 closeout covers one authenticated target account and both frozen Queue/Mesa
projects. #71 subsequently added current-version two-project storage/channel probes,
a second authenticated principal, current request traces and unchanged scoped
compute counters. #92 now adds real-invitee admission, reversible access revocation,
session invalidation, paired audit evidence and an explicit migration from the
read-only historical Session to a new current-principal Session. Distinct author/reviewer identities
remain required for official model publication.

## Next execution packet

1. Start from the Project's current milestone, [Pi online recovery and core-flow acceptance](https://github.com/jihegao/riffology-cloud/milestone/1).
2. Pi track: [#87](https://github.com/jihegao/riffology-cloud/issues/87) stays closed. Complete [#104](https://github.com/jihegao/riffology-cloud/issues/104)'s deployed Private Beta acceptance and observation; operate only within its frozen limits after new execution risks are resolved. The expired project-specific acceptance window is not a standing production policy.
3. Historical provider usage and fee reconciliation continues only in P1 #101. Do not retry, settle, refund or rewrite the seven original records.
4. Acceptance track: #78/#90/#87/#71/#92 are Done; select one of #83/#65 as capacity and dependencies permit. At most one Pi standing-capacity task and one deployed-feature acceptance task are active. Record deployment/model identity, steps, results and remaining gaps on the issue.
5. #35's first official Queue case, #75 email access and #85 skills are the next batch after the core path stabilizes. Other broad architecture/commercial tasks remain candidates; #73 retains its archived decision.
6. Use [the Queue research protocol](invited-queue-research.md) and [acceptance ledger](evidence/invited-queue/acceptance.json) when that phase is reached. Missing observations stay `null`/pending. Existing [local validation](invited-queue-delivery-validation.md) and [branch dispositions](branch-disposition-20260919.md) remain historical references.

CI runs local checks with no cloud/provider credentials. It cannot close A–D by
itself. Do not use closing keywords for issues whose own exit conditions remain open.
