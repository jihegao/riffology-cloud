# User-preview Research Loop acceptance — 2026-09-14

## Decision

**Passed.** Commit `81d6b7d6f776e9dbd52480a271979031716005a1` is deployed to `user-preview`, controlled user admission is enabled, and one ordinary-user Research Loop completed with durable, version-bound evidence and an exact-runtime offline replay. A follow-up acceptance explicitly changed a model assumption, inspected the saved Model Spec, and ran a new version-bound experiment. The deployment was left open for controlled users.

This acceptance supports closing #29, #30, #31, #32, #33, #34, and #45. It also supplies the full-loop evidence needed for #28. No issue was closed during the acceptance; this report and its sanitized evidence package are the only intended Git changes. #37 remains open because the run observed a Trusted Pi release deadline/recovery event even though bounded recovery subsequently cleared it.

## Release identity and gates

- Git `HEAD`, `origin/main`, and the requested source all resolved to `81d6b7d6f776e9dbd52480a271979031716005a1` before deployment.
- Worker version: `f2a8e4e6-570f-4fef-be53-7bfbbf2cf25e`, deployed at 100% with tag `source-81d6b7d6f776e9dbd52480a271979031716005a1`.
- Release profile: `user-preview`.
- Enabled gates: `M2_TURNS_ENABLED`, `M3_SERVICE_ENABLED`, `M3_PREVIEW_ENABLED`, and `M4_SIMULATION_ENABLED`.
- Remote D1 migrations: none pending after applying `0009_model_submissions.sql`.
- Public root returned HTTP 200; unauthenticated `/api/health` returned HTTP 401 as expected.
- Full `npm run check` passed before deployment: M2 `681/681`; M3 `625` passed with five explicit Docker-only skips and zero failures; Phase 1 validators `9/9`.

## Durable identity chain

- Project: `f6c050f3-1f97-427c-886f-051b55307da4`
- Workspace: `d18b450c-c1cf-4cd0-95a3-fd5541c23368`, generation 1
- Session: `d52fd10d-c3e5-4820-9e09-1d623fef22f4`
- Frozen experimental Revision: `d4f8894a674fee2fb729cd543b22f64687289b07bac934e15b80032b2a1c5ac8`
- Model files SHA-256: `20bb40025bdc15d7edac511eaac4a43d60aac46e2b36a689d2c8b6265d086563`
- Model Spec SHA-256: `9b08de569de0a2e2a6f88296eebf3aac3866f3e0d1b8e89d49d33c56d46622bb`
- Final interpretation checkpoint: `1e7a26ad43de7af5f98ab801d41316a53aadebbf07ee7fc6837089c2c9fe2090`; its files and Model Spec hashes are unchanged from the frozen experimental Revision.
- Assumption-edit Revision: `bab5a9fcdc191f5d7c183527c44d1ef8155260962e6ea3c7b3cf305ea5142708`.
- Assumption-edit model files SHA-256: `676e756a7737188240addf35ac700396677c532d4d8e70f20e891631b2832c49`.
- Assumption-edit Model Spec SHA-256: `56127762c33f8d0d1158280e65ddbcf91ba123deddd02ea763f1dbead407b867`.

## Ordinary-user flow exercised

The browser flow covered sign-in, blank Project creation, an Agent-built Model Spec and Python model, Preview, a structural model change, baseline/intervention comparison with repeated seeds, evidence creation and verification, an evidence-linked Agent conclusion, refresh/reopen without automatic execution, progressive Model/Runs/Inspect navigation, ZIP export, and offline replay. The follow-up used the same ordinary-user UI to request deterministic rather than exponential service duration, inspect the updated assumption in Model, and launch a comparison from that new Revision.

Desktop split-workspace layout was checked at 1600x900 and mobile tab switching at 390x844. The corrected Preview showed the research question, finite waiting room and balking mechanism, top-level run seed, parameters, six metrics, assumptions, and limitations. Preview health returned HTTP 200 and its service was explicitly stopped.

## Accepted experiment and conclusion

- Experiment group: `cecc53d7-3f06-43b4-848a-9d05677a5bcc`
- Baseline: one server; intervention: two servers.
- Shared parameters: 80 customers, arrival rate 0.8, service rate 1.0, queue capacity 20.
- Seeds: 101, 102, and 103 for each arm.
- Terminal state: six of six Runs completed; zero failed, cancelled, rejected, or excluded.
- Every accepted Run has a durable `summary.csv` record with SHA-256 and size.
- Baseline mean wait: `2.9339407578559347`; intervention mean wait: `0.16263220523226252`; delta: `-2.771308552623672` time units.
- Baseline mean throughput: `0.8241556783745478`; intervention mean throughput: `0.8302734764724886`; delta: `0.006117798097940774` customers/time.
- All accepted Runs served 80 customers and observed zero balking at these settings.
- Evidence claim: `26a3721c6a7b83e1bfd9864f5819c06e718f597bc25969b5e11281bf5f74a065`.
- Fresh authenticated verification: `evidenceValidity=verified`, `stale=false`, six exact Run references, no exclusions. `olderRevision=true` is expected because the Agent's later interpretation-only checkpoint changed the Revision ID without changing model files.

Accepted Run IDs:

- Baseline: `72088110-aa8f-4447-9318-79c22fbef854`, `48d622a2-9602-4c98-95a7-54bd8f4029e2`, `45ca17c3-19ca-4030-9989-457383d7f73c`
- Intervention: `9d975852-7a54-4e02-ad3d-1d3fdeaab5cb`, `b1e4ef8f-2ad3-43a8-8df9-ed6f4746cc03`, `b494878f-e9f0-4c05-bf5c-bffb86484e27`

The final Agent answer cited the exact frozen Revision, experiment group, evidence claim, all six Runs, arm means, delta, sample counts, exclusions, evidence state, assumptions, limitations, and one follow-up question. It labeled throughput as a direct Experiment reading rather than fabricating another claim.

## Explicit assumption-edit acceptance for #28

The user requested one scoped scientific-assumption change: replace exponential service duration with deterministic duration `1/service_rate`, while retaining seeded Poisson arrivals, FIFO finite waiting room, balking, the research question, top-level Run seed, and declared `summary.csv` output.

- Turn: `4109637d-06af-49d8-8f8e-d938bf7e6b3c`.
- The final provider response failed with `pi-turn-failed`, so the conversation is not recorded as a successful Agent response. Its checkpoint persistence independently read `saved` with no persistence error.
- The exact R2 checkpoint archive SHA-256 matched `676e756a7737188240addf35ac700396677c532d4d8e70f20e891631b2832c49` and resolved to Revision `bab5a9fcdc191f5d7c183527c44d1ef8155260962e6ea3c7b3cf305ea5142708`.
- The saved Model Spec and Model UI both show `deterministic service duration equal to 1/service_rate`; `model/run.py` uses `service_time = 1.0 / service_rate`.
- Independent execution of the saved archive was byte-identical for repeated seed 101 in both `result.json` and `summary.csv`; seed 102 changed the result. A capacity-zero finite queue conserved all 80 arrivals as 43 served plus 37 balked.

The subsequent UI comparison was bound to the new Revision and hashes above:

- Experiment group: `3d5369c5-a76a-428d-86fe-18d72610058a`.
- Baseline: deterministic service, one server; intervention: deterministic service, two servers.
- Shared seed: 201. This single paired seed is a narrow workflow acceptance, not a general scientific estimate.
- Terminal state: two of two Runs completed and released; zero failed, cancelled, rejected, or excluded.
- Baseline mean wait: `1.782928700940174`; intervention mean wait: `0.06446519365117583`; delta: `-1.7184635072889982` time units.
- Both Runs served 80 customers, observed zero balking, and retained durable `summary.csv` hashes.
- Evidence claim: `fb667df1c272ffd6766d27a77acc9253022f3234e1ca027c197b66305b36330d`; fresh authenticated verification returned `evidenceValidity=verified`, `stale=false`, and `olderRevision=false`.

This closes the previously missing #28 acceptance transition: user assumption change → updated Model Spec and model → new Revision → later Experiment and verified evidence. It does not expand the scientific conclusion beyond the recorded paired seed.

## Rejected historical evidence

The first group, `e771e1eb-71dd-47f3-83d8-60fa0477dc1e`, exposed a real model-contract defect: it ignored the platform's top-level Run seed and did not declare its CSV output. It was explicitly rejected under assessment `d48069a8c6a3cce9b430a19fafe7ae9943dc734096006304a7e13f7f04d652c2`; all six Runs are excluded from the accepted conclusion. The corrected model was then saved as the frozen Revision above and rerun from scratch.

Two Agent turns saved valid files but failed while producing the final provider response. Their checkpoint persistence was verified before continuing; neither failure was treated as a completed conversational result. A later conclusion contained a Revision typo and was superseded by the exact corrected conclusion.

## Export and replay

- Export ID: `bc5988d7-ac7f-4237-a1a3-9fbcea03b555`
- ZIP SHA-256 from response header and local file: `abb6eae6c311106c8280f2a531bdd7e64181b14cd903ff4959307d91c0b32f8f`
- Inventory: 44 manifest-listed files plus the manifest itself; two sources, two groups, 12 Runs, two claims, and one assessment.
- `replay.py --verify-only` passed.
- Exact recorded Cloudflare simulation image `sha256:be02d18823ae778f3eb3d73e87772e90549c4f2a5a2e22777067ea5e6775f888` (Linux/amd64, Python 3.11.14) reproduced Run `72088110-aa8f-4447-9318-79c22fbef854`: all metrics matched, `summary.csv` SHA-256 matched, and `matches=true`.
- A native macOS/arm64 Python 3.11.14 replay intentionally failed closed on the CSV hash because one floating-point value differed in the final decimal digit, while all metric comparisons passed. Therefore the acceptance relies on the recorded runtime image for byte-level replay, not on a claim of cross-platform byte identity.

Export artifact: `.local/research-loop-acceptance-20260914-81d6b7d/research-export.zip`.

## Final release and resource readback

- Controlled admission: `enabled`.
- Workspace: `activeTurnId=null`, `resourceWait=null`, `releaseHold=null`, `recoveryHold=null`.
- Current Revision is the saved assumption-edit Revision `bab5a9fcdc191f5d7c183527c44d1ef8155260962e6ea3c7b3cf305ea5142708`; current files SHA-256 is `676e756a7737188240addf35ac700396677c532d4d8e70f20e891631b2832c49`.
- Valid experiment remains complete; rejected historical evidence remains version-bound and rejected.
- Final review readback at `2026-09-14T22:04:26.787Z`: Simulation 31/31 inactive, Service 18/18 inactive, Trusted Pi 118/118 inactive, Project Tools 64/64 inactive, Project Runtime 6/6 inactive; total non-inactive instances: 0.

One Trusted Pi teardown crossed the release deadline and temporarily produced `recovery-hold / trusted-pi-release-deadline-exceeded`. A single bounded recovery observation reconciled the already-inactive cloud instance and cleared the hold. The assumption-edit follow-up also observed `trusted-pi-release-assignment-guard` before accepted work and while the next queued Run waited; both Runs eventually released without manual cleanup or resubmission. Final Workspace and Cloudflare inventory were then reread independently. This is why the Research Loop is accepted but #37 should remain open for lifecycle/reuse hardening and latency analysis.

## Evidence location

The committed, sanitized evidence package is [`docs/evidence/research-loop-user-preview-20260914/`](evidence/research-loop-user-preview-20260914/). It includes the release and final Cloudflare readbacks, accepted experiment identities and artifact hashes, verified claims, export manifest and exact-runtime replay, the assumption-edit model snapshot, UI captures, final Workspace state, and `SHA256SUMS`.

Raw request intents, receipts, authenticated snapshots, checkpoint archives, browser profiles, and the full export remain under `.local/research-loop-acceptance-20260914-81d6b7d/` and are intentionally excluded from Git. The final local authenticated snapshot after the assumption experiment is `final-review-signoff.json`; the fresh sanitized cloud summary is `final-cloud-review-readback.json`.
