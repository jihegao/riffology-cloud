# Post-merge ordinary-user acceptance — 2026-09-14

PRs #38, #39, #40, #41 and #42 were re-reviewed and merged sequentially into `main`, retargeting each next PR to `main` after its prerequisite merged. The merged source is `4fc90de7d4d5663e2d8c38091ffc146bbf38f36a`; its tree exactly matches the reviewed candidate `a38a0a1823084df39f22edd72eb0c1eb49431a9a`. The original checkout was fast-forwarded without removing its untracked evidence.

Pre-merge re-review found no new blocker. The 31 targeted backend/Workerd/timing tests and 39 browser/request-boundary tests passed. The existing full check on identical application code passed 1,633 tests, with six explicit skips and no failures. These are local results, not remote CI results.

The normal logged-in browser account was reused at https://m1.riff-demo.gaojihe.cn. The closed preflight version was `0e1df8f8-5d6b-4097-8f29-a35f11d0f5ed`; Workspace admission was maintenance and a new Turn POST returned 503 without increasing the four existing Turns. Controlled execution used open version `5139bbb2-003c-47d5-87d8-1dec87196ae2`, tagged with the full merged source SHA. All five actual pinned image/resource configurations were independently read and validated.

## Live review regressions

- A 9,000-character ASCII message was blocked by the browser before any POST. A direct ordinary-user request to the actual Gateway returned 413. A message containing an invalid control character returned 400; its draft remained editable after refresh. None of these requests created a Turn.
- Finite experiment `7c83827a-5640-4476-8c23-2ca7611adadf` was accepted with servers=2 and seed=99, then its browser response was deliberately dropped. After refresh, the same values remained visible and frozen. While this intent was pending, Pi saved a new structural Revision. The pending form hid the newly added parameter and continued displaying the original version. Explicit retry used the identical key/body and returned the original completed Run, without creating another experiment.
- Pi Turn `65cf26f1-bdc7-4ea8-a207-693c88a2173a` was submitted in original Session `4274eab3-70f5-4c1a-8a93-8f540cd6dce4`. Its accepted response was also dropped. Refresh made no automatic POST; explicit retry returned 200 replayed, with identical key/body and only one new Turn (four before, five after). Pi then completed and saved actual Python, Spec and Preview changes.
- The saved model added `arrival_scale` (0.5–2, default 1), used it in the effective arrival rate, and added `mean_sojourn`. The archive SHA-256 was independently verified. Its 40-row CSV recomputed all saved metrics, including sojourn from completion minus arrival.

The dispatch-authorization failure cases remain covered by the actual SQLite quota implementation and counted native ports locally; no intentional failure was injected into the live quota service. The successful cloud runs alone do not establish every failure/recovery case.

## Version and execution lineage

Workspace `26e250fc-e36e-45ba-9848-fbb62a167323`, Project `6daf0cc4-0987-4362-bd98-8dd54d95bf02`.

| Version | Revision | Files SHA-256 |
| --- | --- | --- |
| Before structural change | `91d8a44bf7981c00343fe5a4b176ff797ccfae9c4a004620d8aae2b09e42ca13` | `67b3aea0ace5079e56bfbe1c28b77cce6c177da7edb112f419fafca4f0647cb8` |
| After structural change | `d20609f49c51fa3a6e0b10bffac2c595b17d6cf63b71738ca978fc1014b106cf` | `b01c7d649506b2071d237f779acf9a73ff4743dc8f310c6b6e80013bb7e887cc` |

All finite runs used servers=2, seed=99, customers=40, arrival_rate=1, service_rate=1 and setup_time=0.1. The new model runs additionally used arrival_scale=1.25.

| Run | Version | mean_wait | max_wait | mean_sojourn |
| --- | --- | --- | --- | --- |
| `7c83827a-5640-4476-8c23-2ca7611adadf` | Before | 0.21552008334214584 | 1.2677430482364116 | not declared |
| `806206fb-a970-49da-861c-3cfc803ce028` | After | 0.3016503470531185 | 1.7281589727325652 | 1.2627332307622823 |
| `2c5b5f13-436a-4f01-b817-dc900c712347` | After, repeated input | 0.3016503470531185 | 1.7281589727325652 | 1.2627332307622823 |

The first Service `73abf6e0-060b-4fa7-a856-9d18821e22e3` initially appeared unknown, then reconciled to running without another start. It served the real “Queue preview v2” page. An initial iframe health probe returned 403 while opening Preview; a later read of the existing frame returned both root and `/health` 200, and the service was explicitly stopped. The precise initial access-timing cause is not proven. Transient unknown/access observations are retained and are not counted as healthy samples.

The two new-version runs reproduced identical metrics and CSV hashes. All three result envelopes and output CSV objects were read directly from R2 and verified against their advertised digests. One CLI R2 read had a local connectivity failure; only that immutable read was retried. No simulation was resubmitted for the download failure.

New-version Service `508acd65-6d9c-4300-8385-b93769283368` served the actual “Queue preview v3” page and `/health` 200, fixed to the new Revision. It was explicitly stopped.

Final closed Worker version: `7231a0d6-13ca-4509-938a-ebdff397a917`, source tag `source-4fc90de7d4d5663e2d8c38091ffc146bbf38f36a`. Profile: **isolated-acceptance**. All four execution/Preview gates were read back as false after deployment and again after diagnostic cleanup. Raw browser/R2/cloud evidence is under `.local/postmerge-acceptance/`; credentials and diagnostic capability values are excluded from committed evidence.

## Final smoke and cleanup

The final ordinary-user smoke restored the original Session, servers=2, seed=99 and arrival_scale=1.25. It read the saved files and completed Run, made zero automatic Run POSTs on refresh, and rejected a new Turn with 503 while keeping the Turn count at five. Both Service runs were stopped and the Workspace release hold was null. The first harness assertion ran before the Workspace snapshot loaded; waiting for the original Session option fixed the assertion without an application change or additional execution.

Two independent quota observations reported occupied=0, unknown=0 and no leases. Three full cloud inventory observations, including one after diagnostic cleanup, validated the final source/version, closed gates, pinned images and resources, with zero non-inactive instances across all five applications. The temporary read-only diagnostic Worker was deleted; a separate Cloudflare query returned Worker-not-found code 10007. The diagnostic tail was stopped.

This was focused post-merge reacceptance of an existing ordinary-user project, including cross-deployment continuation; blank-project creation was not repeated. These three new Runs do not constitute a same-Revision parameter intervention pair, so this record does not claim the broader `phase1-release-profile` experiment-lineage validator passed. The deployment remains isolated acceptance, not an open user-preview release.

Sanitized [evidence records](evidence/phase1-postmerge-20260914/scope.json), [cleanup readbacks](evidence/phase1-postmerge-20260914/cleanup.json), [recovery checks](evidence/phase1-postmerge-20260914/recovery.json), and [SHA-256 manifest](evidence/phase1-postmerge-20260914/SHA256SUMS) are committed. Raw authenticated browser logs and diagnostic capabilities remain excluded.
