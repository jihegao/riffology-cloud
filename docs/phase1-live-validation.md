# Phase 1 isolated cloud acceptance — 2026-09-14

Implemented, committed and pushed as draft PRs #38–#42. The final deployed application source is `e70be282ff65aa60d589ff5ac1235a0b891a151d`. The subsequent evidence-only commit does not change deployed code. No PR was merged.

The final Worker version is `1b6592e8-0049-4268-9553-516227f7030b`, with full source tag `source-e70be282ff65aa60d589ff5ac1235a0b891a151d`, at https://m1.riff-demo.gaojihe.cn. Profile: **isolated-acceptance**. All four gates are closed. This is a completed isolated acceptance run, not an open user-preview release.

## Real ordinary-user path

The user signed in through the normal browser login; no fixture identity or test-token authentication was used. In an empty project, Pi wrote actual Python, `model/model-spec.json`, dependency declarations and a separate HTTP Preview entrypoint. Files/Diff were inspected, and the saved R2 archive hashes were independently verified.

Project `6daf0cc4-0987-4362-bd98-8dd54d95bf02`, Workspace `26e250fc-e36e-45ba-9848-fbb62a167323`, original Session `4274eab3-70f5-4c1a-8a93-8f540cd6dce4`.

| Model | Saved Revision | Files SHA-256 |
| --- | --- | --- |
| Seeded 40-customer queue | `478f32e7cb57196a8ed1a6adc4792388f71f92957a7583bf9723d1901a154baf` | `68a356fdf49a649fd8ff10eae1dab56c2a1795d80fc1377f9e5a4ef6cdaaa37e` |
| Added setup_time, max_wait and actual customer CSV | `e0c62ce162b06319e2fb3ca0453c51df44e921dd87820cf88da96fd064e76217` | `67b3aea0ace5079e56bfbe1c28b77cce6c177da7edb112f419fafca4f0647cb8` |

The second Pi turn referred to persisted prior experiment IDs and metrics without the browser supplying those results in the prompt. Later read-only conversations saved fresh conversation Revisions with the same second-model files hash; those do not change the structural model lineage above.

## Finite execution and Preview

All successful runs used seed 42, 40 customers and arrival/service rates 1. Each result is bound to its Revision, Spec digest, effective parameters and immutable result digest in [results.json](evidence/phase1-20260914/results.json).

| Run | servers | setup_time | mean_wait | completed | max_wait |
| --- | --- | --- | --- | --- | --- |
| `2979c6a7-b6bc-4408-8338-59db0ee02def` | 1 | — | 0.898589750002442 | 40 | — |
| `4dd0a90e-50c5-4b90-83a2-9e5336c32d53` | 2 | — | 0.059786256452770824 | 40 | — |
| `e03e2236-3387-4ea2-b4fc-e07e6aa694c7` | 2 | — | 0.059786256452770824 | 40 | — |
| `0a096737-6787-4061-b6dc-a44559b423fa` | 2 | 0.1 | 0.07228625645277101 | 40 | 1.448813572472595 |

The repeated identical input reproduced metrics exactly. This checks seed/input association, not a general claim that one intervention always improves a random model. Parameter changes left the Turn journal and saved code unchanged (one Turn, cursor 450 before/after). An out-of-range servers=0 request returned 400 before execution. Old results remained readable and were marked as older versions after the structural change.

The final Run persisted a 3,415-byte `customers.csv` with 40 data rows, SHA-256 `5d715e0b0e6d1d65dd1342cfca5a8ea3aaca28a470adec54118d94e3a369dc6f`. Its R2 bytes matched the advertised digest; recomputing mean/max wait from those rows matched the saved metrics. Three result envelopes were downloaded independently and matched their advertised hashes.

Two real Service/Preview pairs were checked through the browser iframe, not a fixture: Service `26a9d4b3-0b29-41eb-9d78-baee24a54ec9` served the first model (heading “Single queue / multi-server”), and `899facaa-ef0f-40bb-9e74-179764713575` served the second (“Queue preview v2”). Both actual `/health` endpoints returned 200. The first Preview ID, Session, Run and edited servers value survived a browser refresh. Both Services were explicitly stopped after testing.

## Recovery findings and fixes

A slow initial Workspace snapshot allowed sending before the selected Session was restored. This created an unintended second Session during acceptance. The record is retained: Session `1c90aa30-da22-4838-a2f1-01f9002d5c21`, Turn `6b5859aa-3f94-4588-b35d-8709ddd74b59`. The UI now waits for the first authoritative snapshot and persists the selected Session, draft and pending idempotency intent before submitting. Refresh never automatically resubmits.

The final live response-loss test used original Session `4274eab3-70f5-4c1a-8a93-8f540cd6dce4`. The browser interceptor sent the POST to the server, recorded its 202 receipt, then dropped the browser response. After refresh, explicit retry returned **200 replayed**. Worker traces contain exactly these two POST responses; durable state contains exactly one new Turn, `38473fb2-976f-46af-842c-b9c48b1824cd`, in the original Session. It completed and saved. The test harness initially expected 202 for the retry; this assertion was incorrect. The existing receipt, trace and Workspace were reconciled without creating another Turn. Browser regression tests separately verify identical key/body/Session and no automatic POST on refresh.

The stale Preview rejection now distinguishes a changed saved Revision from an idempotency conflict. UI tests cover the old-version banner and explicit retry against a fresh target. This final error-code change was verified by targeted tests, not an additional live stale-target POST after gates closed.

One initial Service (`fbb11d7e-c125-426f-8fef-bbbc394188cc`) and one finite Run (`1b9210c9-2da7-476d-b35b-d3abe80efec1`) had unconfirmed startup. They were stopped/reconciled and resources released before fresh attempts; no failed/unknown result was labeled successful. The exact initial transport cause remains unproven. Stage-only diagnostic logs were added, and later attempts completed. These observations do not establish general cold-start reliability or a latency SLA.

## Final validation and cleanup

`npm run check` on deployed source: **1,612 passed, 6 explicitly skipped, 0 failed** (M0 350, M1 189, M2 531, M3 533, release scripts 9 passed). Native Linux Docker acceptance previously passed five cases; the production linux/amd64 images were pushed and exercised by the cloud runs above. Remote CI is not being claimed.

Paid execution occurred while gates were temporarily open. Final application source was tested on open version `309150a1-489d-42a7-aafa-5d7b330bb039`; earlier execution used the preceding acceptance versions. The final closed deployment uses the same application source as 309150a1, with all four gate values false and the full source tag. The release manifest's final smoke is a post-deployment **read-only/closed-admission** ordinary-user smoke; it does not claim new execution with gates closed.

After final deployment, the ordinary-user Workspace returned maintenance, Send was disabled, a new Turn POST returned 503, and the Turn count remained four. Model, Files and the saved final experiment returned 200. Accepted cleanup continued with the gates closed; `releaseHold` became null. Tenant quota readback showed occupied=0, unknown=0, no leases. Two independent full cloud inventories matched the deployed version, gate values, all five pinned images and actual resource limits (max_instances=1, 0.25 vCPU, 1024 MiB memory, 4000 MB disk), with no non-inactive instances. Unrelated account applications were left untouched.

The temporary diagnostic Worker `riffology-phase1-probe-c13c3d0078e435ef757419a2` was deleted; an independent Cloudflare read returned Worker-not-found (10007). The main Worker remained at the final closed version.

Machine-readable evidence is in [release.json](evidence/phase1-20260914/release.json), [recovery.json](evidence/phase1-20260914/recovery.json), and [inventory-validation.json](evidence/phase1-20260914/inventory-validation.json). The evidence validator passed; it validates supplied structure and does not independently reproduce the live run. Local raw archives, screenshots and logs remain under `.local/phase1-release/`; their selected checksums are committed in [local-artifacts.sha256](evidence/phase1-20260914/local-artifacts.sha256). Authentication state, capability secrets and raw traces are excluded. Original checkout evidence was preserved.
