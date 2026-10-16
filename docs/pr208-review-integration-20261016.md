# PR208 review and PR223 integration preparation — 2026-10-16

The author head was checked before and after review: PR208 remains `dcbb782ae90ae8e4eafa0aad26d3ff30deea9e8f`, with no new author commit. Its scope is issues #206/#207: initial copied Files, first Managed context and empty Preview cleanup. PR223 is `f625f0193e2964148a990a3af502e7a581ceb688`. The production deployment remains its default-disabled backend with retained old assets; this review deploys nothing.

## Finding: validate the declared initial file digest before dispatch

In PR208 alone, `ManagedProductRuntime.#baseFiles` resolves and validates the initial reference but does not compare the resulting archive digest with `input.base.initial.filesSha256`. The new first-session context path consequently accepts a request with a forged declared files digest. A real local Workerd/R2 fixture, with all provider requests intercepted, reproduced **two provider POSTs** instead of the required zero. This violates #207's pre-dispatch source/digest condition. It is an internal runtime-contract gap; no ordinary-user exploit or production request was exercised.

The isolated fix compares `resolved.filesSha256` before returning the archive and rejects with `initial-workspace-files-mismatch`. The negative test checks zero provider POSTs, then proves the same correct request still succeeds and remains idempotent across restart. Local commit `fcd10b045d9c4dd7f4274ce13337078a3d209cad` is on `codex/pr208-review-20261016`, based directly on the author head. Only the runtime helper and its test changed (7 additions, 1 removal). The author's remote branch was not changed.

PR223 already rejects this mismatch through `projectResourcesFromArchive` before reservation. Thus this finding does not establish a hole in the current disabled production backend. The local composite retains that earlier guard and adds the copied-source digest regression expecting `project-resource-source-mismatch`; it does not add a redundant second implementation.

## Integration result

Local composite `25812ea81724f822ccb84b9921b6c89a5f19c231`, tree `fcc4d50a81d5f439ba8f8d45764d43209a92113b`, applies the author PR208 delta to PR223. Two explicit textual conflicts were resolved: preserve current release evidence while adding the historical PR208 entry, and retain all PR223 i18n keys plus `files.initial`. Production source merged mechanically.

The first composite run exposed duplicate imports inside the generated Managed fixture: both branches added initial-checkpoint/reference helpers. This prevented its 46 Managed tests from compiling; the 47 browser checks still passed. Consolidating those imports fixed the fixture. No assertion was removed. The final Managed suite also covers the manual-save source, resource selection, source hash, warm continuation, cold recovery, unknown execution, original-key idempotency and release boundaries.

| Check | Result |
| --- | --- |
| Original author head: Managed + Preview/Workspace | 90/90 passed |
| Added initial-files digest negative before fix | Failed as expected: 2 intercepted POSTs, expected 0 |
| Standalone narrow fix: complete Managed suite | 43/43 passed |
| Standalone fix typecheck/diff | Passed |
| Composite initial run | 47 browser passes; 46 Managed compile failures from duplicate imports |
| Composite after fixture correction: complete Managed suite | 46/46 passed |
| Composite UI checks | 21/21 passed |
| Composite typecheck/diff | Passed |

Node 26.10.0, cached Playwright Chromium and existing OpenSSL3 were used. Provider traffic was intercepted; browser pages and Catalog identities were synthetic local fixtures. There was no production project access, invitation, credential change, cloud browser, paid execution, merge or deployment. The focused review did not claim a full repository or hosted CI pass; the later full local run is recorded below. [Sanitized evidence](../evidence/releases/pr208-review-integration-20261016.json) retains hashes for successful and failed runs separately.

The original author's root-cause diagnosis remains unproven for the old Fire project. Any future authenticated acceptance uses a newly authorized project, preserving the purge/unknown boundaries in #207. PR208 should either consume the narrow standalone fix before standalone integration, or integrate with PR223 while retaining the earlier resource-digest guard and copied-source negative test. Neither local commit is a production rollout approval.

## Full local validation and draft delivery

The complete `npm run check` exited **0** on frozen composite `afa8473939494fe146b7312440d120a97078b042`: **3136 Node passes, 13 conditional skips, 8 Python passes**, plus typecheck. It took 430.963 seconds. All package-script components completed in that single invocation. The run used Node 26.10.0, Python 3.9.6, cached Playwright Chromium and existing OpenSSL3. Twenty-five cached upstream assets were independently size/hash verified; all three documented materialization steps passed without download or installation. No environment credentials or opt-in cloud/paid/Docker variables were passed.

Managed provider POSTs terminate in the Workerd fixture's in-memory `outboundService` handler, with `synthetic-key-no-network`; they are not real provider execution and incur no real model calls/fees. This statement concerns these tests, not account-wide billing. The existing PR223 archive-digest guard remains before reservation/POST, and both its original resource negative and the new copied-source negative pass; no redundant standalone guard was introduced.

The complete raw log archive retains the original standalone digest-negative failures, the first composite import failure, all focused follow-ups and the full check. Per-file/archive SHA-256 values are recorded in the evidence JSON; no failed run is relabeled. These are local results, not hosted CI, native cloud-container or authenticated-user acceptance. The final delivery commit adds documentation/evidence only after the tested source.

The independent Draft PR targets the PR223 branch and offers an integrated delivery path for PR208/#206/#207. The author PR208 branch remains unchanged; selecting this path does not automatically close or merge either PR. It excludes PR225 and must not be mixed into the unfinished PR223 frontend rollout. No deployment or policy change is authorized by this candidate; manual-save admission and generic-page production execution remain closed, with the existing 92 assets retained in production.
