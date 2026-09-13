# Phase 1 review fixes

This follow-up addresses the four inline findings on draft PRs #38, #40, #41 and #42. Fixes are committed to the corresponding branch and propagated through the existing dependency stack using normal merges; published history is not rewritten. #39's independent Model Spec contract is unchanged. Review threads remain available for reviewer verification.

## #38: failed/cancelled stage timing

The last retained phase now closes at durable `finishedAt` (or the retained terminal event), including failed, cancelled and interrupted execution. A retained `turn.started` is required to infer that preparation ended at the terminal boundary when no requesting event exists. This relies on the journal's prefix-only retention: an earlier retained phase boundary proves a later boundary was not cropped. Missing phase boundaries remain unknown, and terminal records never accumulate elapsed time against the current clock when their finish boundary is missing. The earlier tool-completion/Turn-completion distinction is also included in this prerequisite PR.

## #40: one-shot dispatch versus native start

A new durable `dispatchClaimed` flag records the authorization attempt separately from `startClaimed`. Only a confirmed grant for the exact lease permits the native-start intent. A consumed or uncertain dispatch with no native intent becomes a failed, never-launched Run and confirms lease release without calling native start, observe, stop, destroy or running probes. The original dispatch authorization is never replayed. Lost release acknowledgements reuse the same persisted proof.

A late dispatch response cannot continue to native execution after its bounded wait has failed. Cancellation between dispatch and native intent uses the same no-native release path. Once a native-start intent exists, uncertain execution still uses conservative observation and confirmed-stop release. Legacy persisted records without the new flag retain their conservative old interpretation; the new code does not fabricate no-start proof for those ambiguous records.

Regression coverage includes exceptions before and after consuming quota authorization, a timed-out authorization arriving later, storage acknowledgement loss, cancellation during dispatch, lost release acknowledgement, legacy records and overlapping alarms. Tests use persisted SQLite state and the actual quota implementation, with counted native ports. The existing Workerd restart test still covers automatic alarm execution and one native start; its native ports are fixtures, not cloud execution.

## #41: frozen pending experiment display

A pending experiment restores its original parameters and Seed and disables editing/default reset. A separate immutable request summary displays its Revision and digests, parameters and Seed even when the current Model Spec has changed. Retrying preserves the exact original key and body. Only known preacceptance input/version failures unlock editing; ambiguous conflicts and transport failures retain the request.

## #42: editable confirmed rejections

Confirmed preacceptance message validation or body-size rejection clears the pending message intent while preserving an editable draft. Unknown responses and idempotency conflicts retain the frozen key/body/Session. The client measures the UTF-8 size of the complete JSON request against the Gateway's 8192-byte limit, including JSON escapes and multibyte text. Previously persisted oversized messages can also return to editable drafts. Error recovery is scoped to the actual message submission, rather than unrelated Session creation or subsequent reads.

## Review mapping

| PR | Fix commits on its branch | Regression coverage |
| --- | --- | --- |
| [#38](https://github.com/jihegao/riffology-cloud/pull/38) | `422919e` | 14 timing cases, including retained/cropped terminal phases |
| [#40](https://github.com/jihegao/riffology-cloud/pull/40) | `2f3326f`, `263edc8` | 16 SimulationHost cases; Workerd restart and Gateway/quota integration |
| [#41](https://github.com/jihegao/riffology-cloud/pull/41) | `b47d0a0`, `394e7fd`, `25e7237`, `f9f49f3` | Frozen seed 99 and parameters across reload/schema change; exact retry; stale versus ambiguous rejection |
| [#42](https://github.com/jihegao/riffology-cloud/pull/42) | `025ca03`, `a04eabc`, `02835dc`, `cfadb09`, `e096eda` | Editable 400/413, old oversized intent, unknown/conflict retry, frontend/Gateway byte-limit parity |

## Validation and deployment scope

`npm run check` passed on integrated application source `088f0cd08df4b87a71a83b7a9765fa079a1a7b44`: **1633 passed, 6 explicitly skipped, 0 failed**. Passed groups: M0 350, M1 195, M2 538, M3 541, release scripts 9. The subsequent documentation commit does not change tested application code. Targeted checks also passed on the A, C and D prerequisite branches. The full local log is `.local/review-full-check.log`, SHA-256 `6deebe38074525f76a8bb20529d919e8f7f114ba21f9497e2ea03f9ca0479b6b`. These are local/review-branch fixes; this follow-up does not deploy, reopen admission, merge PRs, or repeat paid cloud acceptance. The earlier [cloud acceptance record](phase1-live-validation.md) applies to its stated source and Worker version, not automatically to this changed candidate. Its initial startup limitations remain unresolved by this review follow-up.
