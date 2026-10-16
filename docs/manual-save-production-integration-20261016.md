# Restricted manual-save source integration — 2026-10-16

This candidate reconciles the already deployed restricted manual-save behavior with the split review branches. It is stacked on PR #227 at `03fce9572ebca0c7b50dad7549867d3dbac89ce9`, which depends on PR #221 at `8de9da57b4fd7e051614b6c682e4c2d336a714d5`. It incorporates only PR #223's production policy/compatibility implementation (`482522f`) and reproducible v7-reader/migration tests (`0063455`), plus the GC repair and extended regression from the separately retained production repair. No private acceptance commit or history is imported. PR #225 and PR #226 are excluded.

## Resulting behavior

Manual saves use a default-closed exact actor/authVersion and tenant/project/workspace/generation policy with a bounded time window. Stopping or expiring the policy rejects new operation keys while retaining the original operation's recovery. Ordinary journals remain v7-compatible until manual history requires v9. An old v7-only deployment must not take over a workspace with manual history; stopping admission requires a compatible forward version with the original policy retained.

The RevisionStore serial lane permits a fully validated completed GC result in the same revision shard, including a cold-start outer `unknown` phase, without deleting its terminal evidence. Unresolved GC, a deleting object, another commit and a foreign shard remain blocked. Workspace receipt handling detaches/disposes the RPC aggregate at commit and both reconcile boundaries while preserving strict protocol validation and rejection of unknown symbols.

The new regression file contains one real Workerd integration test and one adapter test. The integration covers completed-GC preservation, all four blocking cases, lost-ACK original-key GET/POST recovery, policy stop/new-key denial, one immutable manifest per original operation, released fences and fixture-scoped zero Turns/outbound fetches. The v7-reader and real SQLite migration-retention tests are also retained. Final candidate HEAD validation belongs in the linked PR; historical suite counts do not certify this new HEAD.

## Bounded production acceptance already recorded

The separate production repair was deployed as Gateway version `0cd876af-8cd3-4eaa-baa9-48c194cfbc76` on 2026-10-16. Its frozen module is 5,690,572 bytes, SHA-256 `577f3319b2c51338e1fe34ddd9370fe0b92985cdd5ebaa78f3f6bc7165e19e4c`. The two repaired production files in this candidate match that retained source exactly; this is source correspondence, not a new deployment of the candidate.

Independent server evidence at 14:53–14:58 UTC confirmed the one authorized ordinary-owner operation committed, its original fence released, zero pending fences in the selected scope, a single immutable manual manifest, and matching manifest/archive/target-file content and hashes. Only the target file was returned for verification; the whole archive was not exported. No global zero-execution, zero-cost or independent runtime/container-release claim follows from those observations.

The user reported successful refresh/leave/reopen at 21:49 UTC. At 21:55:02 UTC the user reported a matching second-account identity and `not_found` from the original workspace's Files and manual-save capability URLs in an independent session. These are user reports: HTTP status codes and request traces were not captured. Actual cross-owner save POST denial, broader endpoint isolation, revocation races, next-Turn baseline and general manual-save availability remain untested. The separate local/AMD acceptance operation is not this production operation and is not declared recovered here.

The latest independently observed production policy remains `enabled:false` at 14:53:52 UTC, retaining the original scope/expiry for recovery. This integration sends no production write or recovery request and does not change configuration, invitations, credentials, migration state or admission. Private user/project/operation identities, response bodies and raw evidence remain local.

## Merge and next-goal boundary

PR #221's precise-head invited-page, broker, second-identity, revocation/browser-cleanup and nine-egress acceptance remains outstanding. This stacked candidate does not satisfy those conditions or authorize merging its parent automatically. Independent review must assess the actual dependency order; do not lower schema9 state to the reduced schema7 candidate. The restricted source reconciliation and broader page delivery remain separate acceptance scopes under #214; neither issue closure nor a Done transition is implied.

The next safe step after this candidate's exact-HEAD checks is independent review of its code, compatibility and dependency graph. Subsequent production deployment, expanded manual-save admission, provider execution and isolated-page acceptance are separate actions. Existing pending operations and history must retain their original identities.

## Deployment-trigger observations

At approximately 22:20–22:25 UTC, GitHub `main` was `fbc0e46bde2c8781b71609fa4524d2e75bffaf99`; its branch protection was false, repository rulesets and repository webhooks were empty. The source workflow runs local validation on PRs/main pushes and has no deployment step. The enabled dynamic Copilot reviewer is separate from deployment. The installations API returned 404 and is not evidence of an empty installation list.

Read-only Cloudflare inspection in both existing accounts found zero Builds triggers and zero deploy hooks for all 15 `riffology-*` Workers in the runtime account and the `riffoid-entry`/`riffoid-www` Workers in the domain account. All three Pages projects across the accounts were examined: the only Git-connected project points to a different repository; none connects to this repository. The first Pages list attempt used an invalid page size and failed; the corrected paginated query returned all projects. No deployment automation was disabled or modified. These observations cover the inspected GitHub and Cloudflare configuration, not every possible external automation.

Delivery Project lookup failed because the existing token lacks `read:project`; no permission refresh or Project write was attempted. Scope and evidence are linked through #214 and the integration PR until Project access is available.
