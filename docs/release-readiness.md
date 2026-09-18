# Current release readiness — 2026-09-19

This is the current delivery index. Historical release records are evidence for
their own source/window, not proof that the current deployment passes.

## Release identity

| Item | Evidence / status |
| --- | --- |
| Baseline | Local and remote `main`: `727c40f11a5b5e2fd2eebace05e4bd3971955432`, checked 2026-09-19 |
| Candidate | `codex/invited-queue-delivery`, isolated from the dirty `codex/g5-bounded-unsettled` checkout |
| Current Gateway version | `0ca0acc2-fed7-43fe-9fdf-dd19d1e9b9c5`; source manifest `5fc122b57ed6307eb584f170c7f082f950f465934666468248f6c4e8e47589bf`; see [#83 delivery](issue-83-preview-ui-delivery.md) |
| Current execution Worker version | `ead25cd0-74c1-43cd-b604-64dc1b8325d4`, 100% of current deployment |
| Fresh active-version / configuration readback | Authenticated Cloudflare GET on 2026-09-19; both active versions above confirmed. [Allowlisted readback](evidence/invited-queue/release-readback-20260919.json) |
| Candidate deployment | Not performed; deployment, merge, gate changes and new paid requests excluded by this task |
| Rollback | Code rollback baseline `727c40f`; before any future deployment read and freeze the actual active Worker/assets/configuration as the operational rollback target. No database reversal or ledger reset. |

Pi/G5/model-provider/legacy-preview/simulation flags read `false`. The current
G5 window has no `billingPolicy`. Managed acceptance is disabled, but schema-2
**account-level Managed testing is enabled**. This is not an all-execution-closed
claim, and creating a fresh project for that account is not proof of a Pi route.
The source manifest is a release digest, not a Git commit. Deployment metadata
readback does not verify the deployed bytes or the private execution counters.

## Delivery gates and accountable work

| Batch / issues | Current state | Owner / exact remaining exit condition |
| --- | --- | --- |
| A: #83 | Code already on remote main; historical aa interaction proof retained | Release maintainer: update issue record; complete current-version refresh, narrow viewport, stale/current version and failure-state matrix before closure |
| A: #78/#64/#65 | Fresh Safari login reached existing projects; official catalog empty. Opening old G4 Queue displayed the historical-runtime conflict and left Model loading | Workspace maintainer: candidate fixes account-wide Managed testing overriding legacy Pi reads; deployed Queue + Mesa local rerun/seed/playback/refresh/independent-page acceptance still required |
| A: #71 | Existing real browser isolation tests retained | Release verifier: current-deployment two-run/two-project storage denial and second authenticated principal; request trace AND scoped authoritative compute counters must agree |
| B: #46/#68 | Bounded billing candidate imported, local verification only | Budget maintainer: review candidate; closed deployment/readback; exact historical terminal/tool evidence; separately frozen execution allowance before live research |
| C: #35 | Existing publication/copy implementation; honest Queue entry added; no official Queue published | Author + distinct reviewer: ordinary author → baseline/comparison/export → submit → non-author approval → new-user copy and independent run |
| D: invited users | 0 observed participants; no research outcomes claimed | Product owner: 3 participants; all explore, at least 2 independently compare and return in a second visit; record intervention and unknown cost separately |
| #73 | Archived bounded experiment imported; decision `retain-current-runtime` | Research maintainer: preserve frozen negative result; run offline regression only; no new provider allocation |
| #77 follow-up | GitHub issue closed; complete Managed production E2E remains incomplete | Runtime maintainer: retain closed policy; model → native Experiment/Evidence → Preview/Verify → same-Session continuation requires a separate authorized run. Existing late-save/cleanup evidence does not satisfy this chain. |

Fresh browser observation is limited to one account and Queue navigation. It
does not prove zero server execution, Mesa compatibility, deployed source identity
or a second user's ACL. Browser control reported a user app change before further
actions; no browser session or credential was exported into this repository.

## Next execution packet

1. Review the candidate and [branch dispositions](branch-disposition-20260919.md).
2. Complete [local validation](invited-queue-delivery-validation.md); retain failures and conditional skips.
3. A future release must freeze actual active versions, assets, bindings and rollback;
   this task supplies no deployment or execution authorization.
4. Use [the Queue research protocol](invited-queue-research.md) and
   [acceptance ledger](evidence/invited-queue/acceptance.json). A missing observation
   stays `null`/pending; never convert a fixture pass into an online/user pass.

CI runs local checks with no cloud/provider credentials. It cannot close A–D by
itself. Do not use closing keywords for issues whose own exit conditions remain open.
