# Grouped Experiment API (#30)

Local implementation contract; cloud acceptance and issue closure are separate. The existing `/experiments` single-Run routes and stored identities remain supported. New research groups are additive and use the same Workspace authorization, simulation feature gate, native runner, quota, immutable result publisher and release guards.

## HTTP contract

Base: `/api/workspaces/:workspaceId/experiment-groups`.

- `POST /` with `Idempotency-Key` accepts an immutable research plan and returns its public view (`202`). No Run or native resource starts in this request.
- `GET /?before=:groupId` returns `{items, nextCursor}`, newest first, ten groups per page.
- `GET /:groupId` returns the public view without creating or resubmitting work.
- `POST /:groupId/cancel`, JSON `{}`, records cancellation (`202`). Pending children create no native resources. An active child still requires normal stop and release evidence.

Exact creation body (`ExperimentGroupRequest` in `services/simulation/groups.ts`):

```json
{
  "revisionId": "saved-revision-id",
  "filesSha256": "64 lowercase hex characters",
  "specSha256": "64 lowercase hex characters",
  "hypothesis": "Does changing the server count reduce waiting?",
  "baseline": {"label": "Baseline", "parameters": {"servers": 1}},
  "interventions": [{"label": "Two servers", "parameters": {"servers": 2}}],
  "seeds": [42, 99]
}
```

`revisionId` may be null for the verified initial model. Hypothesis: 1–2,000 characters; labels: 1–80, nonblank, distinct, without control characters. One baseline, 1–3 interventions, 1–20 unique uint32 seeds. Repetitions equal seed count; at most 80 children. Parameters resolve and validate against the saved Model Spec before acceptance. No source edit or LLM call is involved. HTTP and domain enforce a 32 KiB UTF-8 group body bound; legacy JSON endpoints retain 8 KiB. Each configuration also respects the existing per-Run request limit.

The exact response type is `ExperimentGroupView`. It exposes frozen `version`, `hypothesis`, resolved `configurations` (`baseline`, `intervention-1` through `intervention-3`), `seeds`, `repetitions`, the Spec's metric-definition map, `status`, timestamps, `errorCode`, `stale`, `progress`, `runs` and `summary`. It does not expose actor authentication, private intent keys or native control state.

Each child view contains `runId`, `configurationId`, `seed`, `status`, `errorCode`, `result` and `released`. IDs are assigned at group acceptance; `pending` means a planned child without an admitted Run yet. Unadmitted cancellation has `status=cancelled`, `result=null`, `released=true` and no single-Run record. The raw Run endpoint is available after admission. A newly grouped Run's `experimentId` is its group ID, and `groupId` explicitly repeats that association; legacy single Runs retain `experimentId=runId`. Published grouped result envelopes use the same group identity.

`progress` counts `total`, `pending`, `active`, `completed`, `failed` and `cancelled`. Terminal results may still await external release: the group remains running until all children are released. Final group states are `completed` (all completed), `partial` (some completed), `failed` (none completed), or `cancelled` when cancellation was requested. In-flight cancellation records `cancelledAt` while completion/release reconciliation proceeds.

Each configuration summary maps metric names to `{count, missing, mean, baselineMean, delta, errorCode}`. `missing` includes pending, failed, cancelled and structurally invalid results. Only completed children with Spec-valid finite metrics count. `delta` is the intervention's available-sample mean minus the baseline's available-sample mean; it is **not** a paired-seed estimate, significance test, confidence interval or scientific validation. Unequal valid counts remain visible. Nonfinite computed values become null with `simulation-metric-overflow`, never an implicit JSON conversion. Explicit scientific rejection annotations belong to the evidence layer (#31).

## Durable scheduling and recovery

Creation persists the frozen plan, all child IDs, a separate group idempotency intent, storage reservations and the shared simulation wake in one Workspace storage transaction. A group retries by the same actor/key/body; it never refreezes against the new model. At most eight groups remain active and 100 group records are retained. The existing 1,000-Run bound includes reserved future children; legacy submissions cannot consume space reserved by accepted groups.

The group scheduler admits at most one child per group, in seed-major order (baseline followed by interventions for each seed). It waits for the previous child's `released=true`, not merely a completed result, before admission. The existing eight-active-Run cap and ten-minute Run deadline stay unchanged; each child's deadline starts when its Run is admitted, not when the group was accepted. Quota waiting after that admission remains part of the existing Run deadline.

Child Run intents use a private namespace separate from public single-Run idempotency. Admission atomically checks the current group cancellation fence, prior-child release, reservation and feature gate. A lost storage acknowledgement is recovered from the same Run row; a lost native acknowledgement uses the existing observer path without resubmission. Cancellation removes future reservations atomically; it does not erase accepted child effects or uncertain quota/release records. Gate-off pauses new child admission while retaining the group and existing active-Run cleanup. Revoked actor authorization cancels unadmitted children.

Run and group wake projection share the existing logical simulation alarm; pending groups cannot lose their wake when the last legacy Run clears. Workspace's physical alarm still uses the minimum of provisioning, Turn, Service, Observer and simulation deadlines. Reads and refresh never invoke scheduling.

Groups freeze the entire verified `SimulationPlan`, image and resolved parameters. Later saved-model changes only mark `stale`; they do not invalidate or silently retarget queued children. Reads validate each admitted child's group, scope, actor, complete plan, image, parameters and seed before returning aggregates. Corrupt associations fail closed. Historical result envelopes remain immutable.

## Errors and validation scope

Creation validation uses existing simulation error codes: `400` invalid input/Spec/contract/dependencies; `409 simulation-model-stale` or `simulation-idempotency-conflict`; `429 simulation-capacity`; `413 body_too_large`; `503 simulation-unavailable`. Unknown transport/503 outcomes and identity conflicts must retain the original key/body for reconciliation. Read/cancel remains available under maintenance authorization while new execution requires ready state. Private exceptions are redacted by Gateway.

Targeted checks: `node --test tests/m3/experiment-groups.test.ts tests/m3/experiment-groups-workerd.test.mjs tests/m3/gateway-experiment-groups.test.ts tests/m3/simulation-host.test.ts tests/m3/gateway-simulations.test.ts` and `npm run typecheck`.

SQLite unit tests cover acceptance/admission acknowledgement loss, cancellation races, model drift, partial results, private-intent collision, wrong child associations, 80-child planning, active capacity, gate pause and revoked access. The Workerd test exercises actual alarms, SQLite persistence, restart and one native-start intent per child using fixture execution ports. It is not real Sandbox, paid-model or cloud user-journey evidence.
