# G5 #37 runtime observation preparation

Status: partial implementation, offline qualification and a read-only product collector. No deployment, cloud access, model call or container manipulation was performed. This is not complete cloud-driver delivery or #37 acceptance.

## Delivered files

- `scripts/m2/g5-runtime-observation-contract.mjs`: normalized evidence shape qualification; ten completed/saved Turns, stable lease/pair/runtime identity, unique dispatch/token/native process identities, ordinal binding epochs, Session switch before Turn 6, three closed exact-scope ledgers and both domain release/guard evidence. Missing/unknown evidence blocks. Even complete caller-provided input returns `cloudAcceptance:false`: input statements do not authenticate native receipts.
- `scripts/m2/check-g5-runtime-observation.mjs`: reads one explicit local JSON input and independently hashes referenced local raw evidence files. Paths escaping the input directory, including symlink escapes, fail. No network or mutation. Raw evidence SHA integrity does not authenticate provenance; fabricated contents can have valid hashes.
- `scripts/m2/g5-runtime-observation-collector.mjs`: an importable collector for the existing fixed-origin ordinary authenticated `GET /api/workspaces/:id`, single request, 15-second timeout, redirects rejected. Cookie remains in request only. Returns byte hash, observed time and minimal Turn state/checkpoint projection. No new product endpoint, DO reader, deployment, retry or acceptance inference. Always blocked because the public endpoint cannot provide full runtime authority.

Run offline tests with `node --test scripts/m2/g5-runtime-observation-contract.test.mjs`; run local evidence qualification with `node scripts/m2/check-g5-runtime-observation.mjs --input=/absolute/path/observation.json`. No live fixture is bundled or labeled actual acceptance. Synthetic unit fixtures test the contract only.

## Real observations available and unavailable

`services/turn/protocol.ts` PublicTurnRecord omits dispatchId, base and resourceLease. The ordinary workspace GET exposes status, Session, runtimeGeneration, executionOutcome, persistenceOutcome and checkpoint. `services/turn/journal.ts` applyReleaseDisposition validates a handoff then clears releaseHold; it does not persist the complete handoff into public TurnRecord. Null holds are ordinary journal observations, not proof of native release.

Internal `services/workspace/runtime-handoff.ts` computes exact binding/lease, three settlement receipts and native proofs; `services/workspace/durable.ts` owns private runtime leases. Those fields are not supplied by the existing authenticated workspace GET. Missing facts are warm pair/lease authority, binding epoch authority, Project/Pi PID/start identities, three ledger settlement receipts, paired FIFO/capacity rows and dual-domain native absence/guard proof. The collector never substitutes inferred IDs, fixture metrics or a caller's trusted flag.

## Existing runner extension points

`scripts/m3/issues-controlled-release-acceptance.mjs` exports `runControlledReleaseAcceptance` and injects `acceptanceRunner`; it retains gate closing in finally. A future approved live orchestrator can wrap `acceptanceRunner`, call `collectProductRuntimeObservation` after ordinary submission/reconciliation and terminal saves, and persist those GET observations through its private evidence writer. Its existing one-Session ten-Turn result must not be recast as warm acceptance: current final inventory validation in `issues-acceptance.mjs` expects twenty distinct cold actors, which conflicts with a retained physical pair. That validator requires a separate explicit warm profile, not silent weakening.

The collector is callable now but no paid runner is wired or executed. A production/native observation adapter remains required before complete #37 evidence can qualify. Any future adapter must retain actual source API/actor identity, byte hashes, exact scope and immutable release binding, and independently prove native absence and guard intervals. This preparation does not authorize G5 live execution.

Validation update: six focused tests pass, including cross-workspace snapshots, array maps, malformed Turns, fatal UTF-8 decoding and interruption after response collection. The collector validates scope identity and projects checkpoint hashes/time only, excluding object keys. HTTP/source provenance is informational and is not cryptographic authentication of cloud/native evidence.
