# G5 frozen queue benchmark task preparation

Offline preparation only, advanced into an idle runtime subagent slot while A/C continue G2/G3 implementation and true-chain acceptance. It does not bypass those gates. No provider request, account/credential selection, deployment, catalog/model database write, durable project creation or ordinary-user eighteen-task execution was performed.

The existing six categories in `scripts/model/benchmark-plan.mjs` are unchanged. `docs/production-model-path.md` remains the production gate/account/privacy/money contract. This fixture adds concrete task briefs and deterministic domain inputs; it is not a completed paid benchmark manifest or an authorization reference.

Frozen inventory: `scripts/model/benchmark-task-fixtures/fixtures.json`, SHA-256 `3e410718f9143da69f3bc63407f4452ae7802afb299f250657be51a40a756fb4`. `fixtures.sha256` records the exact canonical UTF-8 JSON bytes including the final newline. Reference Python and three five-file source bundles are public, non-secret offline oracles, not claimed provider outputs or saved Revisions. The canonical server adapter is SHA-256 `fa7987095bbc29f2c6d87e9b0f815415f88c9079ad7070fb7fe8b91e7ebf0898`.

## Sequence and domain

Use three independently created ordinary-user queue projects. Within each project run all six tasks in order; each depends on the preceding task and the same project's actual saved state. The fixture execution concurrency is one. This is repetition-major order, not eighteen independent model creations. The existing offline benchmark-plan prints category-major attempts; any future authorized runner must associate those categories/repetitions with these explicit fixture IDs and dependency order. This preparation does not modify that script.

| Task | Frozen scenario and acceptance |
| --- | --- |
| 1 create-model | FCFS exponential-arrival/service queue; customers=40, servers=1, arrival_rate=0.8, service_rate=1. Explicit Spec, assumptions, limitations, Python validation, saved five sources and independent baseline Run. Final completed=40, no active agents, nonnegative finite metrics; queue_length matches waiting agents at every frame. |
| 2 parameter-change | At the same saved source compare arrival_rate 0.8 vs 1.2, keeping other parameters and seed fixed. Source/revision does not change. Under the declared pre-drawn common streams the reference's higher arrival-rate waiting is no smaller. Cite actual input/configuration/Experiment/Run/artifact identities. |
| 3 mechanism-change | Add max_wait 0..100, default 2; abandon before service when waiting exceeds the threshold, with equality entering service. Use arrival_rate=1.5 for the scenario, declare abandoned count and served-only mean_wait. New saved revision; final completed+abandoned=40. |
| 4 repair-validation | Explicit operator injection of frozen failing model.py through the authorized project file workflow, then agent diagnosis from actual Python/tool output. Keep the failed artifact and its injected source digest distinct from the repaired artifact/source/revision. Compilation must fail before repair and pass after repair; repaired model must still satisfy abandonment domains. |
| 5 measured-evidence | Paired servers 1 vs 2, customers=40, arrival_rate=1.5, service_rate=1, max_wait=2, across the repetition's three seeds. Persist complete measured evidence. Explain observed effects and selection in served-only waiting; do not invent a universal monotonic waiting claim after abandonment. |
| 6 reopen-continue | Reopen the same authorized project and recover actual saved files/results without execution. Explicitly add queue_capacity 0..120, default 120; compare 120 vs 2 and declare rejected separately. New revision, complete conservation completed+abandoned+rejected=40, waiting queue bounded by capacity, old results historical, new validation/Run/export retained. |

| Repetition | Primary seed | Paired comparison seeds |
| --- | --- | --- |
| 1 | 104729 | 104729, 104759, 104761 |
| 2 | 130363 | 130363, 130367, 130369 |
| 3 | 155921 | 155921, 155927, 155929 |

Source Spec bounds customers at 120. The reference emits every event and final state without truncation, including the parameter upper-bound scenario and uint32 maximum seed. Nine frozen paired seeds and explicit zero-wait/zero-capacity boundary cases check the finite domain. These bounded cases are not throughput, general stochastic correctness, empirical calibration or scientific forecast evidence.

The injected failing bytes have SHA-256 `2d6a08027a49cd61500ee3ff8cb975d3323ea41a79642e86c60830bfb0b9d50d`: the colon after `def run(config)` on line 5 is removed. Expected result is SyntaxError at that definition; compiler wording may vary by Python version. The reference repair has SHA-256 `43a1605858655b049d28bf5bc34c6da67780d2e4a81bec32bccea8701055bc0e`. A future agent repair must have its own observed source digest and validated domain; byte-for-byte equality to the oracle is not a quality score. Do not feed the reference repair to the agent as an answer and then claim first-success generation.

## Required true-execution evidence

Every fixture ID must map to authenticated account/user/tenant/project/workspace/session/Turn/dispatch identities and the exact source revision/archive digest. Keep actual Tool Bridge event IDs, failed/successful Python artifact IDs and digests, browser package/runtime/profile identities, independent server Experiment/group/Run/input/seed/metric/artifact IDs, evidence cards and export identities. Match persisted claims to artifacts and retain historical-version associations. Fixture IDs and reference bundles are not substitutes for these durable identities.

Capture actual provider request/terminal receipt IDs, usage-quality classification, upstream-attempt evidence, token and money ledger identities, measured latency/cost/first-success and separately adjudicated domain acceptance. Keep provider logs and authorization proofs in their approved private evidence store; no raw prompts, secrets or capabilities belong in this public fixture inventory. The intentionally injected failure precedes the repair task; report it separately from the agent's first repair attempt rather than manipulating the first-success denominator.

The inventory leaves operator, accountReference, authorizationReference, provider, model, profile/runtime hashes, dated price source, privacy/logging evidence, Gateway retry evidence, global/Turn caps, per-task call bound, deadline and actual evidence as null. These are deliberate unresolved inputs. A non-null placeholder string is not permission. Before live work, an explicitly reviewed/account-owner-authorized completed `production-model-benchmark.example.json` must satisfy the existing production profile, privacy, one-upstream-attempt and conservative budget gates. Put this inventory's digest in taskFixturesSha256; never substitute a fake profile/privacy hash. Eighteen tasks does not mean eighteen provider calls: the completed manifest must budget the worst bounded number of calls per task and preserve unknown charges.

Stop on deadline/caps, unknown charge, credential-boundary failure or fabricated execution claims using the existing plan/policy. Do not retry an uncertain provider request or regenerate a task's source silently. The future runner and independent reviewer must preserve failures and missing evidence, including an unavailable runtime or server path. No ordinary-user project/Model/Run should be seeded directly in D1 to accelerate this benchmark.

## Offline validation

```sh
node scripts/model/benchmark-task-fixtures.mjs
node --test scripts/model/benchmark-task-fixtures.test.mjs
```

The first command regenerates in memory and rejects drift against frozen bytes. `--write` deliberately refreshes the offline inventory and hash only; it is not an execution command. The tests validate canonical base64/length/digest/source order, canonical adapter, valid Spec/input bounds, three dependent six-task sequences and unresolved authorization boundary. They compile and execute only the checked public reference Python locally, confirm the seeded failure versus repair, repeat each input for determinism, and check conservation, threshold/capacity boundaries and complete final state. `BENCHMARK_FIXTURE_PYTHON` may explicitly select a local interpreter; no provider/account is involved.

Two offline tests passed during preparation. The initial compiler-wording assertion failed on the available local Python and was changed to the stable SyntaxError/line/cause contract; that diagnostic was not a production/model failure. Neither passing check provides a live task acceptance numerator, provider retry proof, pricing claim, privacy acceptance, deployment proof or ordinary-user benchmark result. The real eighteen-task evaluation remains unexecuted.
