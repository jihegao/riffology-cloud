# External P2 finding and minimal offline fix

The parent relayed an independent read-only finding: reconcileFixture returned consistent directly after readback and omitted the acknowledged path identity ledger checks. An unknown gatewayObserve could retain baseline version/deployment while reporting temporary package settings/bytes. This supersedes the earlier internal no-remaining-P2 report. That report is retained unchanged as historical evidence; it is not external acceptance.

The fix extracts pure validateIdentity(registry, receipt) and invokes it after readback in both paths. Known version identities must retain metadata/module hashes. Known deployment identities must retain their version. Only acknowledged publication writes the ledger; unknown reconciliation remains GET-only, pending stays set, cursor/current/artifacts/lastAt and the ledger remain unchanged. No retry or recovery approval is added.

Before-fix tests: 3 negative cases failed with missing expected rejection, 1 consistent read-only control passed. After-fix full offline suite: 51 passed, 0 failed. Cases cover baseline and historical version content reuse, baseline and historical deployment rebinding, and repeat consistent GET with no state mutation. Logs, exit codes, old publisher bytes and source hashes are retained.

Frozen v2 and previous v3 archives are unchanged. Both a minimal patch against prior v3 and the complete 12-file delta against frozen v2 were checked and applied in independent scratch directories with matching final hashes. Existing typecheck and Entry review bundle evidence remains applicable because their TypeScript inputs did not change; those records are dated prior evidence, not new runs. No installation, live adapter request, real test round, push or deployment.

External re-review of this fix is pending. This record reports local repair and fixtures only; it does not claim external acceptance. restorationStandard and unknownLogClosure remain pending-user-decision; productionAuthorized:false, quietPublisher:false, fullStateMatches:false. No budget/resource/credential change.
