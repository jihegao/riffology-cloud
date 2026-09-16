# G5-A serial live driver

`g5-a-live-driver.mjs` is the reviewed-host orchestration layer for the frozen #46 benchmark. Its default CLI prints the immutable dry schedule and `--execute` is rejected. A host must explicitly construct `G5ACdpDurableRunner`, initialize it with the approved config digest and exact release preflight, then pass it to `G5ASequentialLiveDriver.execute({execute:true})`. No cloud, model or Run was invoked while implementing this module.

The schedule is project-major and concurrency one. Each of three projects has one Session and six dependent Turns in the order create-model, parameter-change, mechanism-change, repair-validation, measured-evidence, reopen-continue. Run counts are 1, 2, 1, 1, 6 and 2. The measured step uses one Experiment Group containing baseline/intervention across three frozen seeds; other steps use ordinary Experiment requests. This totals 3 Projects, 18 Turns, 39 child Runs and three group intents: 63 admission tasks. Three terminal probe Turn slots remain optional, giving the frozen task cap of 66. The first failed, unknown or otherwise unqualified probe closes admission and prevents later probes.

Every mutation uses the existing wx/fsync `DurableOrdinaryRunner` journal and deterministic idempotency key. An intent without an ACK is never reposted and blocks all subsequent mutations. Restart reuses acknowledged responses, performs product GET reconciliation, and returns `pending` without admitting a successor until the current Turn, Run or Group is terminal. Each task checks the saved Turn, exact Revision/files/source version, five required source paths, trusted tool and provider receipts, and closed model/money/tool ledgers with zero pending/unknown. Each individual Run requires a trusted release receipt; each Run or completed Group creates and independently GET-verifies a persisted evidence claim. Immutable sanitized receipts are stored mode 0600 with directory fsync. Raw prompts are present only in the frozen fixture and outbound product request; session cookies and response bodies are not written by the driver journal.

Authentication uses `createG5ACdpTransport`. It attaches to one existing same-origin Chrome page and performs `fetch` inside the page with `credentials: "include"`. Before execution it confirms `/api/me`, a 200 project list for the authorized A tenant and 404 for the B tenant. Before every POST it repeats `/api/me`. Only status values, booleans and an identity hash are persisted; Cookie bytes and raw identity responses never leave Chrome. The transport rejects redirects, non-product paths, non-loopback CDP endpoints, wrong origin and responses over 1 MiB.

Deadline, budget or identity failures surfaced by authority, failed/cancelled Turns or Runs, unknown delivery, invalid source/claim/ledger evidence, release uncertainty, probe uncertainty and final inventory mismatch all call the trusted `closeAdmission` adapter. The local result never claims closure unless the adapter returns the matching window and immutable receipt. Pending known work stays read-only and may be resumed. A delivery-unknown POST remains fenced because the public API has no intent-key lookup that can recover its entity ID.

## Required execution inputs and remaining product/API gaps

A real host still needs these private, reviewed inputs; tests use synthetic adapters only:

- a running Chrome CDP endpoint with the already authenticated first ordinary test user, the exact user ID, A tenant ID and denied B tenant ID;
- the frozen config and out-of-band SHA, writable 0700 journal directory, exact-release/profile/window preflight adapter and operator reference;
- a trusted authority adapter that reads the private G5 guard, provider usage, money and tool ledgers, Run release state and paginated final inventory, and that can durably close admission;
- an authorized seeded-failure injector returning the exact frozen failure SHA. There is no current ordinary-user REST file-write endpoint; the existing benchmark contract says the operator injects it through the project file workflow;
- optional probe preparation/inspection adapters. Probe Turns themselves use the same ordinary CDP/journal path, but fault selection and private ledger observation are not exposed by product HTTP;
- a read-only reconciliation API keyed by idempotency key would be required to resolve a lost POST ACK. Until then, an ACK-less intent stops the window and is never retried.

The public individual Experiment view omits release state, so `inspectRun` must obtain it from trusted storage/inventory. The public Turn/workspace endpoint also cannot prove provider usage or all three ledgers. These adapters are required before live execution; caller-supplied booleans are rejected by the strict receipt schemas.

Validation: `node --test scripts/model/g5-a-live-driver.test.mjs` covers the full 3/18/39 serial path, dry mode, pending resume, unknown ACK stop, missing ledger stop, Chrome CDP tenant boundary and per-POST identity checks, plus first-unknown probe termination. `node scripts/model/g5-a-live-driver.mjs --execute` fails closed.
