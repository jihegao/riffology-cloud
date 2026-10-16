# Manual Revision to page broker regression

Prepared 2026-10-16 UTC (2026-10-17 Asia/Shanghai), on isolated base `f43bb6045a3135267717c982c2e5436ff36edcfd` from Draft #227. This is a local synthetic regression and a narrow frontend repair under #214. It does not satisfy #221's real invited-page Goal1 or change its merge/deployment conditions.

## Reproduced defects and repair

The new integration reproduced three failures against the unchanged base broker: a V1 file response was delivered after V2 committed while that response was waiting; a delayed artifact response was delivered after Catalog membership revocation; and package verification accepted a different expected workspace generation. Restoring only the base production broker file reproduced all three with the final native MessageChannel fixture. Those negative-control logs remain local.

The broker now rechecks host authorization after asynchronous file/artifact reads and before subscription activation or snapshot publication. It retains current-generation and subscription-epoch checks around those awaits. An observed authorization failure notifies the existing host failure callback so that the host closes the old broker/session. Package verification also compares workspace generation when the caller supplies it. Default-closed production page/manual-save policies are unchanged.

## Actual local path

One real Workerd integration has eight sequential subcases. The fixture uses real local Miniflare D1, SQLite Workspace/RevisionStore Durable Objects, R2, Gateway ownership queries, manual-save handlers, canonical package construction and artifact handlers. Only the two synthetic identities and initial empty-workspace checkpoints are seeded for test setup; saved revisions and user-upload receipts are produced by the normal manual-save path, never injected. There is no Better Auth/Google session: the fixture's clearly named identity adapter is not real-user evidence.

The production broker runs in Node and both its incoming requests and outgoing replies cross a native Node MessageChannel. A FIFO acknowledgement is test orchestration only; file/package/artifact response bodies come from the actual local path. This does not render a page, start an isolated Chromium container, or verify browser/Docker cleanup.

The fixture proves:

- Two-page V1 packages match the canonical Revision/files digest; uploaded JSON is read in two bounded chunks with reconstructed content/hash matching its receipt. Reopening reads the same package, and broker route selection recognizes both pages.
- A V2 save invalidates the old package and old artifact endpoint; even an already-read V1 file cannot reach the page after the final authority check fails.
- Both owners receive actual HTTP 404 from the other's package/files/manual-capability/artifact routes; a foreign manual-save POST creates no fence. Backend and frontend stale-generation checks reject mismatches.
- Forged scope, traversal, object keys and write commands are refused without changing canonical object keys, operation/fence state or save-request counts.
- Subscription cancellation and leave discard held real artifact replies. Catalog revocation during artifact-read, subscription-activation and snapshot-publication waits prevents data delivery and closes the test host's old broker/MessagePorts.
- Both actual fixture journals have zero Turns/Sessions and no active manual operation. All three explicit owned saves have released committed fences and exactly three immutable manual manifests. The fourth attempted save is the explicitly rejected foreign POST. The fixture Workerd outbound counter remains zero.

These are scoped fixture counts, not a global zero-execution/fee claim. Uploaded artifacts remain `user-upload`/unverified; this test does not manufacture or validate tool-output receipts. The separate AMD pending operation and all production user data remain untouched. It does not evict/reconstruct a Durable Object.

## Validation and remaining boundary

Final exact-HEAD commands and results are recorded in the linked Draft PR. Initial base failures, an intermediate run where two existing tests depended on a fixed microtask count, and the successful explicit read-barrier correction are retained in private logs. The existing tests now wait for the actual read to start, without weakening their late-result assertions. A browser regression previously waited for a denial reply; observed authority failure now closes the original transport immediately, so it instead verifies original-session closure, canvas removal, no delivered file bytes and the existing explicit retry path.

Related local checks use `manual-page-broker-workerd`, existing manual-save, page broker/package/Gateway, remote-canvas and isolation-policy tests. The final aggregate is the existing `npm run check`, with the existing pinned assets/dependencies, OpenSSL3 and cached Chromium. No installation, Docker image pull, deterministic-provider scenario or production request is needed for this regression.

Still missing for Goal1: actual invited OAuth identities on the selected exact candidate; real rendered pages and canonical broker data; browser refresh/leave/cold restore; actual second-identity/cross-project behavior; revocation and original browser/container cleanup; nine real egress attempts with collector controls. Fixture route/reopen checks and Node MessagePort cleanup do not replace those results. #221/main remains held, no production deployment or gate change is performed, and private evidence is not published.
