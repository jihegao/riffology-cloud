# Phase 1 ordinary-user release acceptance — 2026-09-14

**Phase 1 user-preview release signed off.** Cleanup, both consecutive ordinary-user smoke Turns, final resource release, and independent open-state readback passed. The target profile is `user-preview` at https://m1.riff-demo.gaojihe.cn; the checked-in default remains `isolated-acceptance`.

Final application source is `2c464df88286506a37b1f84139600286bdfc8b48` (PR #44). Its tree is identical to checked commit `76dbdd4a50e35e7552f7a417bfe8532f2f186dd2`. The frozen full `npm run check` passed **1,638 tests, six skipped, zero failed**. The earlier event-batching candidate `90a14ab…` / Worker `52029e31…` passed 1,636 tests and supplied the model/Run/Preview evidence below; the final change repairs browser history recovery. These are local test results, not remote CI claims. Final sign-off rechecks the original project on the final deployment rather than recreating its executions.

## Continuous ordinary-user journey

The logged-in ordinary account created blank Project `d0657c9e-fe49-4b28-8ea8-6b4a4cb6a4de` through the product UI. Workspace `90ac1208-d4bc-4925-b3f0-d02e9a864cb6` became ready after approximately 17.5 seconds; original Session `8205988d-4b2f-4474-aafd-b8f1e16f854d` is reused throughout. No test token, repository fixture, pre-seeded model, or manual runtime start was used. Cloud administration was used for deployment, independent readbacks and diagnostic cleanup, not as a substitute for the product user path.

The first Pi build Turn exposed the event replay CPU problem fixed in [PR #43](https://github.com/jihegao/riffology-cloud/pull/43). Admission was closed during repair. The already accepted original Turn completed and saved through the recovery path; no replacement project or build Turn was submitted. The journey therefore spans the failed candidate and repaired deployment rather than pretending the first candidate passed. [Recovery analysis](phase1-event-batch-recovery.md) preserves that failure. Cold first/continuous Turn behavior on the final candidate is checked again after cleanup.

## File and execution evidence

[Turn records](evidence/phase1-user-preview-20260914/turns.json) bind controlled editing to saved Revisions and timing. [Actual model files](evidence/phase1-user-preview-20260914/models/a/model/run.py) were downloaded from R2 and checked against the saved archive digest. The UI Files/Diff also exposes the structural changes.

Revision A is `b06251b86ad24e4ead0b3179c902e3301a72275fae673caff4cf5c304d096733`, a finite standard-library FCFS queue. Three parameter-only UI submissions used customers=40, arrival_rate=1, service_rate=1 and seed=99:

| Run | servers | mean_wait | Purpose |
| --- | --- | --- | --- |
| `bfe772aa-0a30-4795-8a8f-ba62d3c4b0c2` | 1 | 2.4932877193363012 | Baseline |
| `ac49333f-4322-4457-aa4d-72f061ef1dd8` | 2 | 0.36016908269074116 | Same-Revision intervention |
| `2ab1f808-0e58-4a89-ac66-2a5784d00c0e` | 2 | 0.36016908269074116 | Exact repeated input |

All three submission snapshots contain only the original one Pi Turn. Parameters did not edit code or invoke Pi. The two repeated configurations have exactly equal metrics; the immutable result JSON objects were read directly from R2 and verified. Revision A writes a local CSV but omitted `outputs` in its final JSON, so **no durable A CSV is claimed**. The platform's result envelope is A's persisted output artifact.

Pi's priority change produced two intermediate, scientifically incorrect versions. The first (`3fd857e5…`, Run `73da2349-23b7-4a1f-bd43-0e348e2cc848`) allowed future high-priority arrivals to delay an idle server. The attempted repair (`dc1a4c70…`, Run `6609252a-a70b-48d5-9c6d-aed51eaa4e88`) passed the particular two-server cloud sample but failed an independent one-server sample: an already-arrived high-priority customer was omitted from selection. Both remain persisted, explicitly rejected as acceptance models. A Run's platform `completed` state proves successful bounded execution and validated output structure, **not scientific correctness**. The initial Pi self-checks were insufficient; the independent checker caught the omissions.

The final corrected Revision B is `ebb99156b8218d98fa2dcf78aeb755c9267e3589406dd08e25f62302b5ce8676`. Run `cf76eabb-3d21-4a4a-870d-3074ab3198de` uses servers=2, seed=99 and high_priority_fraction=0.3. Its actual R2 CSV has 40 rows and recomputes all six metrics within 1e-7: mean_wait=0.18736144944864538, mean_wait_high=0.13288366251953743 and mean_wait_regular=0.2236799740680507. JSON SHA-256 is `a50b15e85f4669ca29d95411271ce54eaedae62b68f3acae119e2e688e66c4e3`; CSV SHA-256 is `6ef690306aea522d2f43be7f4ea49458ef81e825fb0fcafb9b40f8ffc17fa1ef`. [CSV verification](evidence/phase1-user-preview-20260914/checked-csv-validation.json) and [22-configuration repeated matrix](evidence/phase1-user-preview-20260914/model-checked-validation.json) passed. Pi also saved and executed an 18-configuration assertion script using controlled project tools. Four valid acceptance Runs are A baseline/intervention/repetition and this B Run; the two rejected intermediate-model Runs are retained separately, making six actual finite Runs total. The [independent CSV checker](evidence/phase1-user-preview-20260914/verify-queue.py) checks arrival, concurrency, waiting, work conservation and priority/FIFO with a 1e-7 tolerance for nine-decimal CSV output. The matrix harness is local validation of downloaded actual source, not additional cloud Runs.

Same-seed A/B comparisons are not a causal estimate of priority effects: B consumes additional random draws for priority assignment, changing the service-duration sample. This acceptance checks input/version/output linkage and within-version repeatability, not a predetermined performance improvement or common-random-number comparison.

## Preview and recovery evidence

Service A `5cbf4d0c-eca0-486d-b890-b8ae1a79f579` was fixed to A and served the actual **Queue FCFS A** Python page. First bootstrap, ticket issue, exchange, root and health were all HTTP 200. Refresh explicitly recovered the same Preview and Service without a Service POST. A controlled browser delay of 31 seconds made a real ticket expire: exchange returned 403, the UI offered recovery, and explicit recovery returned healthy access to the same Service. This is live server behavior with browser fault injection, not an unexplained spontaneous 403 claim.

The A Preview's example numbers were explicitly illustrative; actual persisted experimental metrics were displayed in the adjacent platform Run panel. Later priority pages only explain the mechanism. Preview content is not substituted for saved Run evidence.

Closing/reopening during the already accepted first build retained the same Session and Turn and issued no execution POST. Explicitly stopping A and refreshing preserved servers=2, seed=99, Session and results. Restart was explicit. The first priority Service opened a distinct actual page pinned to its saved version and was stopped after model rejection. The intermediate repair's Preview observation was abandoned while its Service awaited capacity; it is not recorded as a passed Preview sample.

## Release boundary and remaining work

The application continues to use the existing tenant capacity of two and pinned images/resource limits. Release guards can keep new work queued for minutes after preceding execution; neither guard bypass, extra capacity nor container reuse was introduced. This record is not a latency-SLO claim.

Full Experiment comparison/repetition UX (#30), evidence-linked conclusions (#31), reproducible exports (#32), advanced controls (#33), and runtime reuse (#37) remain outside this delivery. #28 stays open as the full research-loop Epic.

## #36 acceptance coverage

| Criterion | Evidence and scope |
| --- | --- |
| Closed gate gives a clear reason, retains drafts and creates no Turn | Ordinary-user post-merge gate-off and 400/413 draft checks in [prior acceptance](phase1-postmerge-acceptance.md); current recovery snapshot remained readable during maintenance. Local Gateway/UI tests cover server recheck and draft semantics. |
| Open gate and no running instance automatically wakes execution | This UI-created project's first Turn and final post-cleanup first smoke; full cloud inventory independently checks inactive resources before final smoke. |
| Capacity/release wait is durable, visible and bounded | Live finite Runs waited without extra submissions; live model-correction Turn waited on `trusted-pi-release-assignment-guard` and then started automatically. Cancellation/FIFO/failure permutations are local dispatcher and real Workerd/SQLite tests, not injected live outages. |
| Lost accepted response reuses one immutable request | Prior ordinary-user browser response-loss injection restored the same Turn/key/body and only one Turn; current journey never replaced a delivery-unknown execution. Local journal/dispatcher tests cover lost acknowledgments. |
| Reopen/DO rebuild/readiness delay preserves progression | Live build page reopen; actual CPU-triggered DO resets followed by original Turn completion/save during repair. Local Workerd tests additionally dispose/recreate persisted state and check one native-start count with fixture execution ports. |
| Errors distinguish startup/provider/budget/maintenance | Local Gateway, journal, model-budget and dispatcher tests. Live maintenance and invalid-request observations are recorded; no live quota/upstream failure was intentionally injected in this release. |
| Final authorized open profile survives cleanup and consecutive smoke | [Final signed record](evidence/phase1-user-preview-20260914/final-signoff.json): two ordinary-user Turns completed/saved after cleanup, subsequent release hold clear and zero non-inactive native instances; isolated profile remains false by default. |
| Saved files/Revisions/results remain authorized and readable during waits | Actual R2 digest reads plus ordinary-user Files/model/Run reads during resource waits; maintenance recovery read and prior closed-gate history smoke. |

This matrix deliberately does not label local fault injection as cloud verification. Prior evidence remains valid only for unchanged behavior and is supplemented by the current release's actual ordinary-user and cloud readbacks.

The final B Service `69b89080-b4db-4b02-8acd-400cd08b5003` is pinned to corrected B and serves the visibly inspected **Queue Priority B checked** page with root/health 200. A full-page screenshot taken before scrolling did not capture the offscreen iframe paint; a viewport screenshot after scrolling confirms actual visible content. A recovery harness initially compared mutable cleanup `updatedAt` timestamps; it was corrected to compare all immutable Run/result fields while allowing those maintenance timestamps to advance. No execution was resubmitted for either observation adjustment.

## Additional recovery blocker found during sign-off

With 2,664 events, the server returned `snapshotRequired=true`, `oldestSequence=617` and `nextSequence=2665`. Reading from 616 returned actual retained events, but the browser rendered zero assistant cards: `readWorkspaceEvents` discarded the entire retained window and jumped to the tail. New-task admission was forward-closed at Worker `36caf9a2-bade-4666-a199-40a63c6235f8`, with original Turns saved, no active Turn and a cleared Turn release hold. Two independent tenant quota observations subsequently reported occupied=0, unknown=0; full native inventory showed zero non-inactive instances.

The repair reads the retained window and explains that older replies are outside the current display range. This is bounded recent-history recovery, not a new promise of unlimited chat transcript access. The full saved Pi Session remains available to execution; saved model and experiment state are independent of the browser event display. Final deployment and acceptance after this repair are recorded below.

The first four Service requests are terminal: A, the first priority B and corrected B were stopped; the rejected intermediate repair Service was stopped during startup and reported `failed / service-unavailable`. It is excluded from Preview success evidence. Native and quota cleanup are verified independently of those public terminal labels.


## Final-candidate recovery and context verification

Worker `85cb008e-f831-4456-877c-10e137fbb1e4` serves source `2c464df…`. The real retained-history recheck restored four recent assistant replies, including the exact latest saved reply, in 25.3 seconds with zero execution POSTs. The browser explicitly states that older replies are outside the display retention window. [History observation](evidence/phase1-user-preview-20260914/history-after.json) records the advancing cursors and ordinary Session identity; it is not an unlimited-history or latency guarantee.

On this final candidate, Service `50b26fb0-db05-4900-a168-f7ceda9bef4b` was explicitly started at corrected B. Ticket issuance and exchange returned 200, but its first page request returned recoverable `503 / preview_unavailable`. This is retained as a failed first-open sample. The read path has a bounded deadline, and the tail showed a late authorization request; the exact source of delay is not established. The ordinary UI **Recover Preview** button restored the **same Service and Preview** to root/health 200, with the correct visible title **Queue Priority B checked** and no execution POST. [Actual recovery requests](evidence/phase1-user-preview-20260914/preview-final-recovered.json) and [visible page](evidence/phase1-user-preview-20260914/preview-final-recovered.png) provide the evidence. No deadline, authorization check or release fence was bypassed. The service was explicitly stopped; refresh retained the same Run, parameters, seed, model and Session, with Preview unavailable and no automatic restart. [Live and stopped refresh records](evidence/phase1-user-preview-20260914/refresh.json) preserve immutable experiment data before and after.

The first post-refresh research continuation correctly described FCFS versus priority mechanisms and A metrics but incorrectly claimed there was no final B Run. A subsequent read-only context audit, whose prompt did not supply the Run IDs or metrics, returned the exact final B Run ID, Revision, parameters, seed and all six metrics from the persisted context. It nevertheless copied final-B fields into the second historical Run entry. These are **observed LLM reading errors**, retained in [continuation evidence](evidence/phase1-user-preview-20260914/continuation.json), not hidden by replacing the experiment. Source review and a successful `researchContext` RPC support the transport finding; the exact latest-B facts independently prove that fresh persisted research data reached Pi.

The narrow Phase 1 context-transport criterion is met; reliable evidence-bound conclusions (#31) are not established. Chat text is not a validated Run record. The platform result panel and immutable artifacts remain authoritative. This distinction also applies to the two scientifically rejected models: execution completion validates output structure, not domain correctness. Neither #31 nor the full research-loop Epic is closed by this acceptance.

Diagnostic cleanup removed the temporary read-only quota Worker and confirmed Cloudflare error `10007` (Worker absent); the tail subscription was stopped. TenantQuota occupied/unknown were both zero before deleting its probe. Subsequent smoke operations use TrustedPiCapacity and do not create TenantQuota-funded simulations or Services, so no post-deletion quota RPC is claimed. Workspace release holds and the independently paginated native inventory are checked again after those Turns. [Cleanup record](evidence/phase1-user-preview-20260914/cleanup.json) and [post-cleanup cloud input](evidence/phase1-user-preview-20260914/post-cleanup-cloud.json) retain the separate observation times.

The post-repair tail interval observed zero Workspace `exceededCpu` outcomes; its maximum replay RPC CPU was 13,223 ms. This sample ends when diagnostic tailing stops, before the final two smoke Turns. Final smoke success is established by durable terminal/save records and cloud inventory, not an invented complete tail interval. Bounded history loading and the approximately six-minute assignment release guard remain visible performance limitations for follow-up #37 work.


## Consecutive ordinary-user smoke after cleanup

Both smoke Turns use the original Session and were submitted from the ordinary UI after diagnostic deletion and the independently verified open/inactive inventory:

| Turn | queued | preparing | executing | saving | Outcome |
| --- | ---: | ---: | ---: | ---: | --- |
| `191005b8-dde1-400c-8a19-72d498ac6112` | 129 ms | 21,058 ms | 20,645 ms | 145 ms | completed / saved |
| `b1c54d19-86d1-41ea-b399-d39c99ad09cd` | 317,047 ms | 31,438 ms | 20,490 ms | 179 ms | completed / saved |

The second Turn was accepted once while the prior release guard remained active; it automatically proceeded without manual infrastructure action or resubmission. The first answer cited the actual current saved checkpoint and latest completed Run `cf76eabb…`. The second continued from that Run and correctly stated the persisted identical/continuously available server assumption and finite stochastic teaching-model limitation. Both saved session archives were fetched from R2 and digest-verified. Both retained the exact corrected-model files digest `5e6401c…`; read-only conversation saves create new checkpoint Revision IDs while Run results remain fixed to their original execution Revision. There were no new finite Runs or Services during these two Turns.

These successful narrow continuation samples do not erase the earlier incorrect answers; the complete selected responses remain in the evidence. Final resource release and gate readback follow these completed Turn records.

An inventory collected during the last release guard completed at `1789362656415` and correctly failed the inactive-instance gate with one Project Tools instance still running. Workspace clearance was observed later at `1789362670643`. This [rejected release-window snapshot](evidence/phase1-user-preview-20260914/release-window-inventory.json) is retained; it is not reused as final inactive proof. The final complete inventory is collected after that clearance.


## Final signed state

The independent final readback confirms Worker `85cb008e-f831-4456-877c-10e137fbb1e4`, application source `2c464df88286506a37b1f84139600286bdfc8b48`, all four gates **true**, Workspace admission **enabled**, no active Turn or release hold, and **zero non-inactive instances across all five container applications**. All five Service requests are terminal; projects, saved Sessions, model files and six Run results are retained. The final two Turn resources have been released. The user-preview site remains open at https://m1.riff-demo.gaojihe.cn.

Both the [user-preview manifest](evidence/phase1-user-preview-20260914/release-manifest-validation.json) and [independent cloud inventory](evidence/phase1-user-preview-20260914/final-cloud-validation.json) pass their validators. [Final sign-off](evidence/phase1-user-preview-20260914/final-signoff.json) keeps the observation times and limitations; [revalidation instructions](evidence/phase1-user-preview-20260914/README.md) and SHA256SUMS cover the packaged evidence. The later evidence/documentation commit does not change the deployed application source; the checked-in isolated profile remains closed by default.
