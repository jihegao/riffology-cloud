# Current release readiness — 2026-10-14

## 2026-10-14 Read-only tool receipt deployed and owner read accepted

[#199](https://github.com/jihegao/riffology-cloud/issues/199) and
[PR #200](https://github.com/jihegao/riffology-cloud/pull/200) add a narrowly
scoped owner read for persisted tool-request terminal evidence. Gateway version
`3789df91-afc5-4e89-8ea7-1dbe7a88036f`, deployment
`1a8687ad-a7a5-42a8-a6e5-295ba1b1805f`, is at 100%. A later ordinary-author
read returned two explicit `not-admitted` receipts and one terminal completed
cleanup receipt with exit code 0; a different authenticated reviewer received
404. The workspace had no remaining active Turn or holds. Earlier 503 responses
followed by successful reads are consistent with deployment propagation, without
proving that cause. No original request was replayed.

Project-scoped compute-count snapshots around three further receipt reads were
deeply equal, and all four sampled Turn dispatches reported supported no-added-call
counters for project tools, Trusted Pi and the tool ledger. This is bounded proof
for those project endpoints; it is not a global-zero or fee claim.

The deployment preserves 99 bindings, 23 SQLite exports, five exactly equal
Worker container association configurations and the safe list metadata for all
15 account container applications. Full account application configuration was
not compared. The prior runtime and asset configuration was preserved; asset
bytes were not freshly probed. Capacity
was restored to paused=false, active=0 and quarantined=0 with the same policy hash,
limits, usage and alerts. The unchanged review time is the current extension in
[#104](https://github.com/jihegao/riffology-cloud/issues/104):
2026-12-31 23:59:59.999 Asia/Shanghai. This release made no policy change.
Receipt API usage and fees remain unknown. The full M2
attempt had 930 passed, zero failed and one cancelled at an existing Workerd
60-second timeout, so the full suite is not claimed passed. The separate six-Run
group under [#196](https://github.com/jihegao/riffology-cloud/issues/196) remains
unfinished and outside #199 acceptance; this entry does not claim
Fire publication, Group completion or formal Experiment evidence.

[Release note](tool-receipt-release-20261014.md) and
[sanitized evidence](evidence/releases/issue199-tool-receipt-release-20261014.json)
record the exact source/deployment identity, authenticated read boundary and
remaining gaps.

## 2026-10-14 NetLogo Fire private local candidate; publication pending

[#196](https://github.com/jihegao/riffology-cloud/issues/196) prepares the first
local Python adaptation from simulation-case-library's five NetLogo candidates.
The example keeps the 31×31 finite world, left-edge ignition/count timing,
four-neighbor spread and ember lifetime, with model-authored Python Canvas drawing
and the unchanged platform adapter. Attribution and CC BY-NC-SA 3.0 remain with
the model; commercial permission is not asserted. Python and NetLogo random
streams are different, so equal seeds do not identify equal forests.

Seven candidate checks and 15 existing Spec/Preview checks passed; typecheck and
whitespace checks passed. Three actual local Chromium/Pyodide runs matched their
complete CPython traces, used only local GET requests and released every iframe.
At density 57%, seed 20261001 and five ticks, the Python candidate reports 523
initial trees, 53 newly burned trees and six active fires. These are local
candidate outputs, not the native library's reference values or production Run
receipts. The locally generated package has a synthetic identity scope.

Independent agent review found no remaining must-fix issue. GitHub
[CI run 38491888673](https://github.com/jihegao/riffology-cloud/actions/runs/38491888673)
failed before any job step: its authoritative annotation reports failed account
payments or a spending-limit problem. Hosted CI did not execute and is not passed;
no automatic retry was attempted. This increment does
not deploy, publish a catalog version, change execution gates or establish
authenticated owner/second-user acceptance. Browser output remains
**local/unverified**; native replay, cross-implementation equivalence, research/gold,
commercial distribution and the ordinary-author/reviewer/new-user publication
flow remain outside this local delivery. [#35](https://github.com/jihegao/riffology-cloud/issues/35)
retains its existing official-model acceptance scope.

[Intake and semantic boundaries](netlogo-case-intake-20261014.md),
[candidate source](../examples/netlogo-fire-candidate/README.md) and
[local receipt](evidence/netlogo-fire-candidate-local-20261014.json) record pinned
sources, actual commands, package/runtime identity, screenshots and remaining gaps.

## 2026-10-13 Managed candidate and Journal receipt fix deployed; acceptance pending

[PR190](https://github.com/jihegao/riffology-cloud/pull/190) and
[PR194](https://github.com/jihegao/riffology-cloud/pull/194) are merged. Their
Managed save/restore, model-authored view preservation and strict late-accounting
receipt fix are deployed at https://app.riffoid.com in Gateway version
`728e5141-d859-4416-8c79-9b92b3ed0b16`, deployment
`6d9f4609-e541-4f6c-a99c-32f18d18510d`, 100% traffic, observed by independent
Cloudflare readback. Deployed source is `3e9b97b6`, a recorded composition of merged
feature/fix code, proved live-domain source and the already-deployed riffoid brand.
It excludes later undeployed domain maintenance code; main alone is not this
release's complete domain/brand source.

M1 passed 348, M2 passed 921, UI passed 21, and typecheck passed. M2/UI inputs
are unchanged from the tested composite; counts overlap with focused checks.
CI was not executed. All 91 manifest-listed live assets match pinned SHA-256; all three isolated
frames and four rejection checks pass. Full platform snapshots preserve 99
bindings, 23 SQLite exports, 5 Gateway container associations, 15 account container
configurations and existing policies. Entry, Browser Execution and www versions
are unchanged.

[#178](https://github.com/jihegao/riffology-cloud/issues/178) and
[#192](https://github.com/jihegao/riffology-cloud/issues/192) remain open at
Acceptance. Anonymous static validation does not establish invited-user save/run,
second identity, paid execution or formal Evidence acceptance. No production
Revision/package was created in this release; Browser output remains
**local/unverified** and candidate reported output **not-recomputed**. Current
capacity and execution boundaries remain unchanged. General artifacts/debug and
requirements/SysML/compiler/Rust implementation remain follow-up issues.

[Release record](managed-candidate-release-20261013.md),
[source/runtime/test evidence](evidence/managed-candidate-release-20261013.json)
and [static readback](evidence/managed-candidate-release-20261013/static-readback.json)
provide the deploy identity, preserved source, actual checks and remaining gaps.

## 2026-10-12 Historical pre-deployment Managed candidate snapshot

[PR #190](https://github.com/jihegao/riffology-cloud/pull/190) repairs the existing
Managed Python/restricted-JS path for [#178](https://github.com/jihegao/riffology-cloud/issues/178).
Candidate v2 preserves model-authored grid/lane/Canvas selection and current JS
roles, checks reported default input/trace/summary, and restores Spec, source,
adapter, lock, visualization, result and frontend after hosted-session cleanup.
Legacy v1 keeps its saved view and explicitly reports absent trace validation.
The existing Browser Mesa runtime dependency closure remains compatible.

The reviewed source is remote commit `b41678889f8152c78783512ed5d47bd64928c602`,
tree `a04f073681a8cf4aa90b139ee6cee759a7ca1e67`. M2 passed 880 tests (including
37 Managed Workerd and 9 candidate tests); UI passed 21, Preview contracts 20,
protocol self-check 1, and typecheck passed. Another 19 Preview registry/build/
Canvas tests passed. Four actual JS-frame browser checks passed using installed
Playwright Chromium after an initial system-Chrome-not-found failure. These
counts overlap and must not be added. Old agent loopback/native-Node failures
were superseded by the unchanged source's successful root-environment rerun.
CI did not execute because of the account allowance and is not reported passed.

[Local evidence](evidence/managed-candidate-local-validation-20261012.json) records
source hashes, synthetic identity, commands, check summaries and fixture package
identities. Candidate output remains `execution: not-recomputed`; fixture package
IDs are static examples, not production Revision receipts. Actual JS tests use
a local CPython Queue trace; they do not establish general airport/ecology models.
Browser output remains **local/unverified**. Deployment, authenticated invited-user
acceptance, second identity and paid execution were not performed. After merge,
#178 remains Acceptance/open; general manifest and actual bounded authoring debug
remain [#182](https://github.com/jihegao/riffology-cloud/issues/182) and
[#183](https://github.com/jihegao/riffology-cloud/issues/183). No online gate,
capacity policy, network authority or historical saved version was changed.

## 2026-10-12 Requirements and Revision contract; design only

[PR #189](https://github.com/jihegao/riffology-cloud/pull/189) supplies the first
design deliverable for [#179](https://github.com/jihegao/riffology-cloud/issues/179),
completion condition 6. The [contract](requirements-revision-artifact-contract.md)
defines stable requirements and source history, trusted user actions, the limited
SysML 2.0 projection, raw IR locators, artifact roles, frozen inputs and backend
capability checks. Mesa is optional in the proposed authoring path; actual bounded
target-runtime debug remains #183. Existing saved profiles retain their meaning.

The reviewed document SHA-256 is
`88b0a9655fd7b811b5d66ee3cc03274ec965601f197ac19bfd179065d784ed4c`.
All 13 local references resolve and whitespace checks pass. The official SysML
sources and pinned compiler snapshot were inspected, but no SysML checker,
simulation, schema implementation, save integration or user acceptance ran.
The remaining requirements implementation stays open; design completion does
not imply that the general workflow, Rust/WASM or formal Evidence is available.

## 2026-10-08 #171 Browser-local Runs deployed; authenticated owner acceptance

[PR #172](https://github.com/jihegao/riffology-cloud/pull/172) is merged as
`abcc406d6e8ec5a6f68932db7e30906cb70e3de2`. Gateway version
`aeddf112-a2be-45da-868c-ed576c55d5ec` is deployed at 100%, deployment
`c6ff55e4-2364-4920-94e0-b8784a1824b5`. Downloaded Worker entry bytes match the
reviewed minified build; all 23 web assets match source SHA-256. Fresh before/after
readback confirms all 93 bindings, compatibility settings, policy pins and all
15 container applications unchanged. No new namespace, capacity policy or image
was introduced. G5/M3/M4 remain closed.

The original ordinary invited owner used the existing Fire project's saved
Revision in Safari. Runs defaults to browser-local execution. One single run
completed with density 0.7, three initial fires and seed 142; a density 0.5/0.6
comparison completed all four children for seeds 42/43, with valid/missing counts
2/0 per configuration. Explicit stop produced a cancelled local record. Refresh
during preparation stopped the request and retained a failed record with
`Load failed` and a cancelled child, without automatic replay. Completed records,
manual drafts and the local default survived refresh and leaving/reentering the
project. The downloaded history preserves frozen Revision/package/runtime,
inputs, per-child metrics and the stopped records. These results remain
**local/unverified**, separate from cloud experiments and publication evidence.

The existing authenticated project count route returned exactly equal JSON
before and after these local runs: Turn, simulation and service admission/dispatch
fences and all supported native attempt/tool counters are unchanged. Unsupported
counts remain null. This is project-scoped counter evidence; the target request
trace, global invited Runs ledger/capacity and second identity remain pending.
It does not establish global zero cloud execution or settle historical fees.
The local fixture separately proves GET-only requests, zero fixture writes,
per-child frame release and Pyodide/CPython metric equality.

The final full M3 rerun passed: primary suite 945 pass / 12 opt-in skip / 0 fail,
plus browser runtime 20, phase1 13 and model validation 92. Earlier UI, typecheck,
M0/M1/M2, #73 and Python checks remain recorded in the October 7 evidence.
GitHub CI did not start because of the account billing/spending-limit failure;
it is not reported as a passing remote check. Original OAuth access was renewed
with the same scopes. A proposed temporary reader and an additional raw tail
were rejected by automatic approval and were never created. The task's original
CLI tail failed its TLS connection and its subscription is confirmed absent.

[Release and owner acceptance evidence](evidence/releases/issue171-local-runs-release-20261008.json)
records identities, metrics, deployment hashes, resource invariants, scoped
counts and remaining coverage. #171 is **Acceptance/open**, with the login blocker
resolved; #136 retains the cloud timeout and wider cloud acceptance matrix.
The October 7 section below is the historical pre-deployment snapshot.

## 2026-10-07 #171 Browser-local Runs implementation; deployment pending

Runs now defaults to **browser-local/unverified** single execution and
baseline/intervention multi-seed comparison for compatible Python models. It
reuses #64's fixed Pyodide package and opaque frame, freezes source/package/runtime
identity and inputs, runs at most eight children sequentially, and retains
individual metrics with valid/missing counts, means and deltas. Explicit stop,
refresh/leave interruption, cross-tab Web Locks, per-child authorization rechecks,
history restoration/download and bounded storage prevent silent replay or loss.
Existing cloud submissions retain their explicit choice and original receipt
contracts; local metrics do not enter Experiment/Evidence/publication APIs.
Terminal historical cloud pause/timeout messages now describe the past run.

Local checks cover the CI stages. M0/M1/M2 and all later stages passed; the M3
primary run's two original cloud expectations were corrected to select cloud
explicitly, then its entire 29-test Workspace file passed. Eighteen new local
interaction tests passed. The real pinned Fire fixture's four Pyodide children
match CPython, release every iframe, and produce only GET application requests
with fixture write count zero. Styled desktop/mobile inspection and 390px expanded
history checks passed. These are local fixture results, not authenticated target
acceptance or paid execution. Details, exact counts and the interrupted/resumed
check sequence are in the [implementation evidence](evidence/browser-local-runs-fix-20261007.json).

Implementation is **not deployed**. Original Cloudflare OAuth expired and could
not refresh; equivalent-scope browser renewal selected another account, without
access to the target account. A historical-snapshot dry run passed, but fresh
settings/resources/capacity readback, actual upload, static readback and authenticated
local Runs acceptance still require the original account login. No cloud Run/Turn
was submitted. The latest user-project cloud timeout remains outside this fix;
#136 stays open for its independent acceptance matrix. #171 remains open and
must not be marked Done on code/PR evidence alone.


## 2026-10-02 #165 parameter drafts and real Cloud Runs acceptance

[PR #166](https://github.com/jihegao/riffology-cloud/pull/166) and
[PR #167](https://github.com/jihegao/riffology-cloud/pull/167) are merged; both final
heads passed full GitHub CI. Gateway version
`ca4a8598-a35c-4234-8140-14990e90af2d` is deployed at 100%, deployment
`ef079f8a-c7bd-4796-aced-591893e6e7e8`, from merged source
`6855c1ea1c7111340c973541ae6f2ad3910d054a`. Downloaded entry bytes match the
reviewed build. All 2,672 tracked files in the deployment source mirror were
compared with the merged tree; all 93 bindings, fixed actors, policy pins and runtime limits are
preserved. Trusted Pi's original application is v11 at 100%, image
`sha256:9b76ab9ee7a4f31d250957fbbeefc62d71056e6bd1eb24686ebbeaff3d65873c`;
the other 14 applications retain their configurations and images.

Cold preparation now has its own persistent, bounded deadline before one native
start. The real single Run took 32.675 seconds from capacity acquisition to
dispatch, completed and released its original runtime without unknown or the
former 15-second self-pause. This interval is acquisition-to-dispatch evidence,
not an assertion that the model program was already running during preparation.
Cancellation, revocation, kill switch, one-shot submission and original release
fences remain; canceled failures retain their safe stage/code diagnostics.

The ordinary invited owner used the original Fire Model and saved Revisions.
Manual parameters survived refresh. A natural-language Pi request actually
completed `project_set_experiment_parameters`; its identity-derived command and
atomic receipt match the saved draft, with `executionSubmitted=false`. Preview,
single Runs and Comparison fields filled automatically. A manual single-form
override after Pi survived refresh; manual Comparison densities/seeds also
survived refresh while the submitted group retained its frozen inputs. The new
saved Revision's code/spec hashes remain unchanged. The old unaccepted single intent stayed frozen until its
original-key observation received a trusted stale-Revision 409; native counts
were unchanged. Both historical canceled comparison groups remain intact.

The author ran Preview locally and stepped its animation; those results remain
**local/unverified**. A new server single Run and one new comparison group used
frozen source and independent server computation. The group has density 0.5/0.6,
seeds 42/43 and four serial children; refresh and leaving/reentering through the
project list continued the same group. Actual completion, metrics, artifact hashes and each original release confirmation are
in the acceptance evidence linked below. No result is promoted from Preview.
The same ordinary owner checked Model publication readiness: all 11 automated checks passed, including current
baseline/comparison and reproducible export; human review is still required.

[Acceptance evidence](evidence/releases/issue165-parameter-runs-acceptance-20261002.json)
records deployments, ordinary identity scope, actual tool arguments/receipt,
request trace, usage, Run results and release confirmations. Model usage is
observed, not invoice settlement; native costs are not inferred as zero.
Historical reservations and alerts remain. Invited Runs and Beta remain Open
within their original review window; G5/M3/M4 remain closed. Temporary readers,
tails and task-owned tunnels are removed after final authoritative readback.

#165's acceptance conditions are satisfied within this scope. #136 stays **Acceptance/open** for the
wider failure/cancellation/timeout/lost-receipt, isolation, second-identity and
publication matrix; this one owner's success does not complete that matrix.

## 2026-10-02 user-authorized Invited Runs opening (#136)

The user confirmed that the local Fire Model preview works and explicitly asked
to open cloud experiments. The ordinary invited owner has an active personal
membership, auth version 2, no platform role and no initial-operator invitation.
The fresh project is ready and unarchived. Its saved drawing Revision is
`9adee17195e958f3e373fc2c5ec497071b9cb565537ba6ccb36f07f673874a99`, with
Preview package
`bf8799b38ad0652b650f07d9ea6abfdb7f9c946a745a4b12cb9600841e6e3409`.
This records the author's local/unverified confirmation for #161; it is not a
server experiment or independently verified scientific result.

**Invited Runs are now enabled** for current accepted invitees through the
existing independent policy, within the original Beta review window ending
October 20, 23:59:59.999 Asia/Shanghai. Gateway version
`89e90822-d6e7-4036-8f17-99d08d7ca42e` is deployed at 100%, deployment
`117a944c-55b0-47c7-9906-b80da5aecee2`. Only the original
`invited-runs-v1` policy's `enabled` bit changed. Downloaded Gateway entry bytes
still match source `aa76856080f536f3481779f082fe62dafad3d9a9`; all other
92 bindings, namespace identities and runtime settings match the prior version.
Version annotations identify this opening operation. The deployment used locked
Wrangler 4.129.0 with `--containers-rollout none`; all 15 container application
configurations, images, versions and limits are unchanged, including Trusted Pi
v9. Browser Execution retains its earlier deployed version.

The original fixed Run actor reports policyReady/enabled true, paused false,
occupied/unknown 0/0. Its bounds remain global/user concurrency 1, 600 seconds per
Run, eight sequential children per group, 360-second release guard, 30-second
quiet and 120-second confirmation grace. The original Beta remains Open,
active/quarantined 0/0 with the same v2 meter-only pin, 30 historical slots,
124 calls, three alerts and 11 operations. Its complete ledger digest matches
before/after. All five current native Dash inventories are complete and empty.
G5 admission, M3 Service and legacy M4 stay closed. Calls and fee hard quotas
remain removed; original metering, reservations and unknown-execution rules stay
in force.

Read-only refreshes in the authenticated ordinary owner's Safari session show
both **Run experiment** and **Run and compare** enabled. The retained comparison
draft is not submitted. No experiment POST, Run acquire/dispatch, paid authoring
Turn or automatic retry was performed. The same Run actor still reports zero
reservations/dispatches after the UI reads; this does not claim zero cloud billing
for the deployment or metadata requests. The expiring metadata reader was
removed after its original-actor snapshots; its capability and task-owned proxy
are cleaned up.

[#136](https://github.com/jihegao/riffology-cloud/issues/136) remains
**Acceptance/open**, P0, owned by @jihegao in the original M1 milestone. The
ordinary-session blocker is resolved. Actual single/comparison execution,
persistent results, publication readiness, cancellation/timeout/release,
lost-receipt recovery and second-identity checks remain pending. The next user
case can use [this Fire Model](https://m1.riff-demo.gaojihe.cn/#/workspace/81424f92-23fb-40fd-8eb1-9c8ea45c690b),
with density 0.5 versus 0.6, one initial fire and seeds 42/43 (four children).

[Opening, actor and authenticated UI evidence](evidence/releases/invited-runs-open-20261002.json)
and [the Run operating contract](invited-cloud-runs.md) record this scope.

## Earlier 2026-10-01 Pi model-authored drawing repair (#161)

[PR #162](https://github.com/jihegao/riffology-cloud/pull/162) is merged as
`60597e28795f27faf7477ec7994d1f7fd283cbec`; its tested head
`25c09071912fdb8f0e5edf3f6799bd69331fcea5` passed
[GitHub CI](https://github.com/jihegao/riffology-cloud/actions/runs/36849986686).
New Python models default to model-authored `python-canvas` drawing; explicit
JavaScript requests retain `javascript-canvas`. Natural-language requests for
state colors or layers trigger drawing in a new Revision of an existing model.
Simulation space and visual renderer are selected independently.

Trusted Pi is now **v9 at 100%**, replacing the v8 image below. Its original
application ID remains `a03628c4-f032-461f-a65b-612ccac11a06`; rollout
`b0c4e738-49c7-40d8-9d25-71efc3f75e57` is completed, with healthy target
allocation and zero current-version instances. The image digest is
`sha256:2f0d2bb404a58f265ed413ef5a253b2ae36bc35f6108e00c290dfc45d7ef7413`.
An offline incremental build retains the deployed v8 runtime/dependencies and
updates only the two active copies of the reviewed Pi release module. A pull of
the immutable registry image followed by read-only/no-network Docker reads
matched all ten retained COPY files to the current source.

Independent reads confirm all 93 Gateway bindings and its deployed version
remain exact; the other 14 application configurations and limits are unchanged.
All five current native Dash inventories are complete and show zero instances
before restoring the original Beta. The operator paused and resumed the original
capacity actor once each; its final observed state is Open, active/quarantined
0/0. Historical alerts/reservations remain. Invited Runs and G5/M3/M4 stay closed.

The real Chromium/Pyodide suite passes **48/48**, including the same draw example
injected into Pi, four distinct forest-state colors, clearing each frame, seed
and density changes, restart, step/playback and existing JavaScript/isolation
regressions. The local full check passes 2,590 Node cases and eight Python cases;
13 existing environment-conditional Node cases are skipped. These are local
checks and preserve Browser Preview's local/unverified provenance.

The original fire model remains the user retest entry point:
[workspace](https://m1.riff-demo.gaojihe.cn/#/workspace/81424f92-23fb-40fd-8eb1-9c8ea45c690b).
Its frozen grid Revision/package is preserved. The author must refresh, ask Pi
to add the requested state colors while preserving computation/parameters,
save a new Revision and restart/step/play Browser Preview. Refreshing the old
Revision alone cannot change its drawing. No fresh paid authoring Turn or Run
acceptance was performed for this release; **#161 remains Acceptance/open**
until the ordinary author retest provides its new Revision/package evidence.

[Deployment, identities and source proof](evidence/releases/pi-model-drawing-deployment-20261001.json)
and [local browser checks](evidence/releases/pi-model-drawing-local-20261001.json)
record the separate source, merge, deployment and pending authoring stages.

## Earlier 2026-10-01 release, complete frozen archive and guarded Pi resume

PRs [#154](https://github.com/jihegao/riffology-cloud/pull/154),
[#156](https://github.com/jihegao/riffology-cloud/pull/156),
[#157](https://github.com/jihegao/riffology-cloud/pull/157) and the minimal
strictly read-only archive proof repair
[#159](https://github.com/jihegao/riffology-cloud/pull/159) are merged.
The final source check [passed](https://github.com/jihegao/riffology-cloud/actions/runs/36822583579).
Source `aa76856080f536f3481779f082fe62dafad3d9a9` is deployed at 100% as
Gateway `4a9e5852-fd66-4097-be04-35f5f341b59d`; downloaded entry bytes match
the source bundle. Browser Execution remains `c94df077-02a1-460f-8158-e47a338e68af`.
All 93 Gateway bindings retain their namespace identities. The image release
changes only the three intended application image pins and the current
`M4_SIMULATION_IMAGE` reference; historical release-image JSONs stay intact.
Runtime, routes, schedules and observability remain as frozen.

Simulation v3, Trusted Pi v8 and Project Tools v3 are each at 100%, with their
original application IDs and completed rollouts. Single-application, version
allocation and exact original rollout reads agree on the new image digests;
earlier application-list snapshots lagged those transitions. The other twelve
account applications, including Project Runtime and Service, remain unchanged.
Actual offline, read-only/no-network Docker reads matched all retained COPY
files to the current source; the two compiler wheels were hash-verified during
installation and removed as specified. Native CPython compiler export/replay
passed 2/2. These are image/build checks, not authenticated user Run acceptance.

The original cutoff `2026-10-01T05:30:00.086Z` and manifest digest
`4a8434a9a940539c90a7cd79ed55204c3592b53d8e031a6418cc5c93593c59d0`
now reconcile **9/9 archived projects across three ordinary invited owners**,
all at epoch 1. The initial nine receipts, including the blocked receipt, remain
exact; one reviewed metadata continuation adds the tenth receipt for that same
frozen project. Independent manifest and SELECT-only identity reads confirm all
frozen identities and current archive markers. No content, ledger or project was
deleted. The strictly read-only proof path does not construct release factories,
stop or replay work, fabricate release, or change the original resource ledgers.
Ordinary owner restore and cross-owner browser acceptance remain pending.

After the original resource checks and completed image rollouts, an authenticated
operator invoked the original guarded Beta resume once. Independent before/after
reads show **Open, active/quarantined 0/0**, v2 meter-only pin/config digest
`67885be43123d0ba94f06c7c06200b9fdd4dcf23b6adacf44a8f525466536e86`,
28 slots, 114 calls, three historical alerts and 1,703,306,300-nanodollar
reservation unchanged; one resume audit takes operations from eight to nine.
The original review deadline remains October 20, 23:59:59.999 Asia/Shanghai.
The migration did not auto-resume. G5/M3/M4 remain closed. **Invited Runs remain
disabled** until the first ordinary authenticated case can be accepted; its
separate global/user concurrency 1, 600-second Run, eight-child group,
360-second release guard and 30-second quiet bounds are deployed.

Public/static verification previously matched 71 fixed assets and 22 web files,
retaining eight runtime identities, all three execution-frame CSPs and five JS
credential/method negative checks. This release preserves those asset bytes and
receipts. Browser Preview remains local/unverified. The browser's available
login is the initial operator, so no ordinary invited new-project Pi/Revision/JS
Preview, single/comparison Run, publication, cancellation/timeout/release or
second-identity acceptance is claimed. The four issues stay **Acceptance/open**,
with the concrete login blocker recorded. The next safe step is an actual
ordinary invited login, then scoped fresh-project acceptance on this deployment.

[Current deployment and linked redacted evidence](evidence/releases/m1-invited-delivery-20261001.json)
separates source/CI, Worker and image deployment, static checks, all-nine metadata
migration, guarded resume, and pending authenticated/paid acceptance. Earlier
8/9 and paused observations below remain historical snapshots.


## Historical: 2026-10-01 initial staged deployment and 8/9 archive snapshot

[PR #154](https://github.com/jihegao/riffology-cloud/pull/154),
[PR #156](https://github.com/jihegao/riffology-cloud/pull/156) and
[PR #157](https://github.com/jihegao/riffology-cloud/pull/157) are merged. Main
`759d598bc608b0bf924c2375f006ca48f1328228` is deployed at 100% as Gateway
`7bed27a8-8b2b-4d57-b4e2-d3ede382aa45` and Browser Execution
`c94df077-02a1-460f-8158-e47a338e68af`. Downloaded entry modules match the
release bundles exactly. The original 91 Gateway bindings and their namespace
identities are preserved, with only the previously authorized v2 policy change
and two additional disabled invited Run bindings; the Execution Worker's four
bindings and runtime settings are unchanged. Catalog migration `0012` was applied
through the normal migration command. All five original container applications
and images remain unchanged.

Public/static reads matched all 71 fixed assets and 22 web files across eight
retained runtime profiles. All three execution frames retained their expected
CSP, credential rejection and site-limited framing. Five synthetic JS-frame
query/cookie/Authorization/method negative checks returned 404. Two initially
inconclusive static GETs were rechecked; both matched. These checks do not cover
an authenticated author's saved Revision or actual browser interaction.

The archive cutoff is `2026-10-01T05:30:00.086Z`: three ordinary invited owners
and nine existing projects, excluding the initial operator's projects. The
frozen digest is `4a8434a9a940539c90a7cd79ed55204c3592b53d8e031a6418cc5c93593c59d0`.
Per-project dry-runs, original metadata attempt keys and independent manifest
readback show eight completed archives at epoch 1 and one
`native-release-unconfirmed` blocked project at epoch 0. All original identities
are preserved; no project/model/session/ledger was deleted. The entire manifest
has **not** passed acceptance.

Original G5/TenantQuota native quiet checks passed. Full original application
inventories showed 23 inactive instances and no active instance across five
applications. That observation does not prove the blocked historical Pi Turn's
Runtime release. Its archive read path constructs a historical release factory;
a minimal strictly read-only Runtime/capacity proof fix is being validated.
Private Beta remains paused (active/quarantined 0/0), invited Runs remain disabled,
and G5/M3/M4 gates remain closed. Three new container images are built/pushed but
not rolled out; actual local Docker CPython compiler export/replay passed 2/2.
The temporary quota, archive and native-read Workers were removed.

Ordinary invited-user Pi/Revision/Preview/Run/comparison/publication and
cross-identity/release acceptance remain pending. The available browser login is
an initial operator and cannot substitute for an ordinary invited identity.
Browser Preview stays local/unverified. The four child issues remain Acceptance
and open. [Initial staged deployment record](evidence/releases/m1-invited-delivery-staged-20261001.json)
separate merged source, deployed Workers, static verification, metadata migration
and unperformed authenticated/paid acceptance.


## 2026-10-01 same-actor meter-only policy migration

[#153](https://github.com/jihegao/riffology-cloud/issues/153) and
[PR #156](https://github.com/jihegao/riffology-cloud/pull/156) remove the Pi
call/monetary quotas, including hidden aggregate Turn limits, while retaining
invitation/owner checks, original historical isolation, per-call token limits,
concurrency, deadlines, kill switch, release proof and request identities.
Source `d28142725bcefb6cb069d2efdddaf856c0b97b47` is deployed as Gateway
`29713453-8529-484b-820e-c64bdb538549`. The original
`private-beta-capacity-v1` actor was explicitly paused and migrated once from
v1 to v2; no new actor, policy ID or ledger was substituted.

Independent authority reads confirmed configured and pinned digest
`67885be43123d0ba94f06c7c06200b9fdd4dcf23b6adacf44a8f525466536e86`.
All 28 slots, 114 calls, three alerts, their hashes and the
1,703,306,300-nanodollar conservative reservation matched the pre-migration
snapshot. One migration audit was appended (seven to eight operations); no
request was replayed. The original 91 bindings change only the policy JSON;
all namespace IDs, five container applications, execution gates and historical
isolation remain intact. The pool remains paused during this integration
rollout. This is a deployed policy migration, not ordinary invited-user Pi or
paid Run acceptance.

[Redacted migration/readback evidence](evidence/releases/private-beta-meter-only-20261001.json).
Private raw snapshots and the frozen operation plan remain separate from public
source. #153 remains Acceptance until the ordinary authenticated paths and
remaining failure/release matrix are covered.


## 2026-10-01 invited Cloud Runs implementation candidate

[#136](https://github.com/jihegao/riffology-cloud/issues/136) adds the ordinary
invited-user Run admission route and a fixed global SQLite capacity actor. It
reuses immutable Simulation/ExperimentGroup/native result and publication paths,
requires #153's same-actor v2 meter-only migration, and integrates #152's archive
write fence. The checked-in Run policy is disabled; G5/M3/M4 and managed gates
retain their existing states. The route is deployed in the integrated Gateway above with admission disabled;
its native container images and ordinary authenticated/paid acceptance remain
pending.

Global/per-user native concurrency is one, each Run has a 600-second deadline,
and a comparison has at most eight sequential children. Terminal results retain
capacity until the existing 360-second guard, 30-second quiet checks and original
stop proof settle. Unknown execution globally isolates this Run actor and cannot
be bypassed through a new project or policy. No call or monetary quota is added;
original model/billing ledgers stay intact. The UI explains capacity/migration,
release and publication failures in both languages and links readiness to Runs.

[Admission, exact resource values, deployment order, local tests and pending live
acceptance](invited-cloud-runs.md). Browser Preview stays local/unverified. The
compiler single-Run route remains intact; Python parameter comparisons remain
the minimal research comparison route.


## 2026-09-27 authorized Private Beta review extension

[Issue #146](https://github.com/jihegao/riffology-cloud/issues/146) and
[PR #147](https://github.com/jihegao/riffology-cloud/pull/147) extend #104's
existing policy through **2026-10-20 23:59:59.999 Asia/Shanghai**
(`2026-10-20T15:59:59.999Z`), following explicit user authorization. The original
September 27 deadline had expired. Policy ID, actor, start time, daily/cumulative
budgets, concurrency, pause and execution gates remain unchanged.

Merge `ff3b2bfaa4a323f0a3d910014a4b8d3a6ceef90f` is deployed at 100% as Gateway
`88385f28-9a2a-4c19-b3b6-67f6c870ff02`, deployment
`c668acf4-e79c-40f3-a579-5281f6a95b14`. Independent readback confirmed all 91
bindings, with only policy `reviewAt` changed, preserved runtime and observability
settings, and exact deployed Worker bytes. Containers and browser assets were
not changed. TypeScript, local M2 844/844 and
[full repository CI](https://github.com/jihegao/riffology-cloud/actions/runs/36301107311)
passed; real Workerd/SQLite tests cover unsafe transitions, preserved ledgers,
atomic audit/pin updates, restart and idempotence.

The deployment-only `extendReview` RPC verified the original pinned digest,
zero occupied slots and no unresolved calls before updating the pin and appending
its audit. A separate post-operation snapshot confirmed the configured and
persisted digests both equal `e7c6a97e7b28f79c77c2a0510242a6b53f6a780ae665e8714bc1b6a350e29eaa`,
`enabled=true`, `paused=false`, active/quarantined=0/0. All **104 observed calls**,
**1,573,785,050 nanodollars** of conservative reservation, limits and alerts
matched the pre-operation snapshot. No Send/Retry, new Turn, provider/tool
request or paid acceptance was performed. #104 remains Acceptance for its
broader participation and exit criteria.

[Release and operation evidence](evidence/releases/beta-review-extension-20260927.json).

## 2026-09-27 Python Canvas adapter repair release

[Issue #144](https://github.com/jihegao/riffology-cloud/issues/144) fixes an
acceptance defect in [#142](https://github.com/jihegao/riffology-cloud/issues/142):
an authored package could declare `python-canvas` and `draw(...)`, yet retain a
noncanonical `model/run.py` and fail the Browser Preview `python-stdlib/v1`
compatibility check. [PR #145](https://github.com/jihegao/riffology-cloud/pull/145)
adds a trusted adapter installation tool, prevents a near-match wrapper from
being written directly, and guides the author to check the adapter first.
`python-canvas` remains supported. The saved Revision that exposed the defect
was not rewritten; it needs a new, compatible Revision for Preview acceptance.

Merge commit `f539808743814dd0e5d1c9076e0a064d8780a5f0` is deployed as
Gateway version `5b65b932-ba17-4c5c-9a0d-fae3c5627e96` (deployment
`70ee13c4-7ae4-4a0b-8246-d46c85dd5549`) at 100% and Trusted Pi container
application version 7 with image digest
`sha256:065d76cb1f5f24c8f77a2762f676d9fa21a36c7317fb439bfd29a849c07b2290`.
The one-instance rollout completed, the instance is healthy, container logs
are enabled, and the other four Gateway-bound container applications retained
their prior versions and images. Independent Gateway readback matched all 91
bindings, runtime and observability settings; downloaded Worker bytes matched
the release bundle. All 22 public web files, 54 app assets and two Browser
Execution frames returned 200 with expected bytes. The Browser Execution
Worker itself was not changed.

Before release, `check:ui` 21/21, TypeScript, M2 843/843, M3 852 passed with
10 conditional skips plus 16/16, 9/9 and 90/90, real Chromium/Pyodide 47/47,
and [CI](https://github.com/jihegao/riffology-cloud/actions/runs/36269254523)
passed. Release verification was static/read-only. No new authenticated Pi
Turn, provider call, model Revision save or paid execution was performed;
the reported traffic project and a fresh `python-canvas` Revision still need
authenticated acceptance. Browser Preview results remain local/unverified.
[Release evidence](evidence/releases/issue-144-20260927.json).

## 2026-09-26 Python Canvas Browser Preview release

[Issue #142](https://github.com/jihegao/riffology-cloud/issues/142) and
[PR #143](https://github.com/jihegao/riffology-cloud/pull/143) add the optional
`python-canvas` profile. The model's Python `draw` entry runs in the isolated
browser Pyodide Worker and paints the Canvas; historical grid/lane profiles
retain their pinned assets. Browser output remains local/unverified.

Merge commit `525855ef483a92d1ddb40aa80f433f1a1b7e9d6d` was deployed as
Gateway version `9274412e-f806-4bc4-be1a-82d48cc021f3` (deployment
`9ef49c36-94ad-4a64-8ab8-1386c0e45a12`) and Browser Execution version
`2bb13fde-5d8c-469b-b772-101575f4838b` (deployment
`1a5e39c7-b08f-4e4e-96e7-02b80ba9db76`), each at 100%. The independent
Gateway readback matched all 91 prior bindings, runtime and observability
settings; its downloaded Worker bytes matched the release bundle SHA256
`7a31f4d806cd9cc8493676c753f54e032fb8eced207795c574ba5d203b690819`.
The Execution Worker retained its four bindings and observability settings.
The new and retained execution frames each returned HTTP 200 from the actual
execution origin, byte-for-byte matching local assets and retaining the
site-limited frame CSP. All 22 public web files and 54 app assets checked on
the main origin also matched source bytes.

Pre-merge Chromium/Pyodide 47/47 and frozen browser regression 37/37 passed;
`npm run test:m3` and [CI](https://github.com/jihegao/riffology-cloud/actions/runs/36216285592)
passed. Production checks above are static/read-only. Authenticated user flow,
the existing traffic Revision and Safari/WebKit remain unverified; #141 retains
its separate model-content scope. No server Experiment, Verify or paid Turn was
run for this release. [Release evidence](evidence/releases/issue-142-20260926.json).

## 2026-09-24 Private Beta draft recovery and capacity diagnosis

[PR #138](https://github.com/jihegao/riffology-cloud/pull/138) implements
[#137](https://github.com/jihegao/riffology-cloud/issues/137)'s safe draft
recovery path. A pending Private Beta request can be withdrawn only after its
original Workspace confirms no matching Turn; a durable fence blocks a late POST
under the original idempotency key. The browser then restores the same draft for
editing. A caller-scoped capacity read distinguishes admission, running,
release waiting and isolated states without exposing other users' identities.
Unknown or accepted requests retain the original recovery identity.

Source `8c3cf69fce35c0cb1d5a93e82471c81973462cc4` is deployed as Gateway
version `9c7b7298-7743-43b4-84f2-c7145bf9f27b`, deployment
`388a54f5-b172-4f5e-8a2a-98154de596cc`, at 100%. Independent API readback
matched all 91 frozen bindings and runtime configuration; downloaded Worker
bytes matched the release bundle and all 17 checked public assets matched source.
The [CI run](https://github.com/jihegao/riffology-cloud/actions/runs/36004367509)
and complete local checks passed with zero failures (UI 21, M1 277, M2 840,
M3 962 passed and 10 conditional skips).

Authenticated read-only Data Studio queries identified the affected user's
original bound slot in the reported Workspace as **quarantined**, with seven
observed calls and a release-unconfirmed alert. Before and after the authenticated
browser recovery, the capacity ledger held one quarantined slot, 18 released
slots, 80 observed calls and 1,207,105,250 nanodollars of conservative
reservation. The original Safari tab showed `review-required`; **Edit draft**
restored the unchanged text to an editable input.

After explicit user authorization on 2026-09-24, the original Workspace's
read-only release method confirmed the bound Turn was terminal and released,
with no resource wait or native release guard. The capacity snapshot showed
only one quarantined slot and 80 observed calls, with no unresolved calls.
The existing guarded `resume()` method released that slot and wrote a `resume`
audit entry at 13:56:38 UTC. Independent Data Studio SELECTs then confirmed
19 released slots, zero occupied/quarantined slots, and the same 80 observed
calls and 1,207,105,250 nanodollar conservative reservation. The original
authenticated Safari Workspace retained the editable draft and visible Send
button after refresh. No Send/Retry, new Turn, provider or tool request was
submitted, so paid execution acceptance remains separate under #104. The
Preview `python-stdlib/v1` incompatibility is separate.

[Release and acceptance evidence](evidence/releases/beta-busy-composer-20260924.json).

## 2026-09-23 rejected-session capacity repair

[PR #135](https://github.com/jihegao/riffology-cloud/pull/135) repairs
[#134](https://github.com/jihegao/riffology-cloud/issues/134): an old Session
rejected after an auth-version change had already reserved the user's Beta slot.
Session/input checks now precede admission. The original Workspace must prove an
immutable Session mismatch, no matching Turn and a quiet journal; the capacity
record must have no bound Turn or calls before it can be returned. The original
slot and alerts remain, with a new release audit.

Gateway version `a2770d8a-5873-4d51-8189-3cf43b530f23` is deployed at 100%. Independent readback
confirmed all 91 bindings, runtime/container configuration, budgets and gates
were preserved, and downloaded Worker bytes match the release bundle.
The uploader omitted the frozen observability setting; it was restored from the
pre-release snapshot and independently verified before acceptance. All 17 public
assets checked match source bytes.
CI, local M2 838/838, UI 21/21 and TypeScript passed.

Authenticated read-only acceptance confirmed the original unbound slot was
automatically released and total occupied/quarantined slots became 0/0. The
73 observed Beta calls and 1,122,985,350 nanodollar conservative reservation
were unchanged. The original Workspace retained nextSequence=648 and no active
Turn or resource/release/recovery hold; the original draft was preserved after
refresh. No request was resubmitted, and no model/tool or paid execution
acceptance is claimed. #104's observation scope remains separate.

[Release and acceptance evidence](evidence/releases/beta-rejected-session-20260923.json).
The UI release record below is the preceding deployment.


## 2026-09-23 UI release and independent readback

PRs #130, #131, #132 and #133 are merged in dependency order. Before merge, all
10 inline review findings were addressed, including durable message receipts,
storage failures, overlapping refreshes, the real Verify POST/GET contract and
locale binding lifetime. [Final code CI](https://github.com/jihegao/riffology-cloud/actions/runs/35759421134)
and the complete relevant local suites passed (M1 275; M3 962 with 10 conditional
skips; check:ui 21; TypeScript).

Application source `1c643fceed1e6b62c3605647a99750ac1a9b3637` is deployed as Gateway version
`cb6935dc-dfed-4d62-8e88-8aa82215ff59`, deployment `6a54ca89-bd48-4ddc-8fac-8ae35d834930`, at 100%.
The actual Catalog received additive migration `0011_user_locale_preferences.sql`.
Independent API readback matched all 91 existing bindings, runtime/container
configuration, gates, budgets and secrets metadata to the frozen prior version.
Downloaded Worker bytes match the release bundle SHA256
`c866085214de1fc0f4dc22ee7a41dbb1b366a3f73bee8621b77f8b209602fb45`. The Browser Execution Worker was not changed.

All 17 checked public HTML/JS resources match the source bytes. A fresh anonymous
browser passed Chinese/English switching, refresh persistence, the admin shell
and 390px layout without horizontal overflow or script errors; its captured
application requests were GET-only. This is public/static verification, not
authenticated user or paid execution acceptance. #126/#128/#129 remain Acceptance;
#65/#83 and #104 retain their separate outstanding acceptance/observation scope.

[Machine-readable release evidence](evidence/releases/ui-20260923.json) records
source, PRs, CI, deployment, hashes and verification limits. The following dated
records preserve earlier implementation and acceptance snapshots.


This is the release and acceptance evidence index. Live priority, status and
ownership are maintained in the [Delivery Project](https://github.com/users/jihegao/projects/1),
not in a parallel Markdown task list. Historical records prove only their own
source/window, not that the current deployment passes. The earlier 2026-09-21 snapshot
includes the authenticated Chrome/CDP Queue/Mesa acceptance, #71's current-version
browser-isolation acceptance, #87's bounded paid Pi acceptance and #92's real
invitee revocation/audit acceptance and revoked-session migration linked below.
They do not complete the
seven-day standing-capacity observation. GitHub, source and live Worker settings
were re-read on 2026-09-21: Gateway version
`2175756e-615d-4525-883b-34395a5bc50e` serves 100%; only the three approved
Pi/M2 gates are open, while G5 and M3/M4 remain closed.

## 2026-09-22 local delivery evidence

[#65](https://github.com/jihegao/riffology-cloud/issues/65#issuecomment-5774124958)
and [#83](https://github.com/jihegao/riffology-cloud/issues/83#issuecomment-5777186998)
record the local layout (23 checks) and preview panel (21 checks) results. Their
remaining authenticated production matrix is separate from those fixtures.
The #65 readback identified Gateway version `2175756e-615d-4525-883b-34395a5bc50e`;
this is not evidence that the changes described below are deployed.

[#128 A](https://github.com/jihegao/riffology-cloud/issues/128) adds the shared
Chinese/English shell, optional account locale metadata, display formatting and
incremental copy checks. [The i18n contract](i18n.md) lists the exact foundation
coverage and the full product-copy migration below. Locale switching retains the
current Workspace nodes, draft, Session, Preview and unresolved submission intent;
fixture checks assert the only added write is the account preference PUT.
The account read degrades without breaking identity bootstrap, while writes
recheck account activity and auth version in SQL after admission.

Local validation covers the real Gateway asset graph, ordinary/admin/Workspace
browser fixtures, preference races, storage denial, post-admission revocation,
additive migration and the existing M0–M3 regression suites. Exact command results
and CI are recorded in the linked Issue/PR. This foundation requires additive
migration `0011_user_locale_preferences.sql` before publishing the new assets.
It has not been deployed or accepted with a current production account; no new
Turn, paid provider call, experiment, gate or historical billing mutation was
performed for this delivery. A alone does not satisfy or close the full #128.

[#126](https://github.com/jihegao/riffology-cloud/issues/126) adds composer progress
through Session creation, Turn submission and confirmed message visibility. The
accepted Turn ID remains in the recovery intent until the matching message is
rendered; late replies cannot unlock another Workspace. The local UI checks cover
46 web cases, 25 Workspace layout cases and 3 independent lifecycle cases,
including rejected browser storage and held receipts with no duplicate POST.
This change depends on the #128 A foundation and has not been deployed or
accepted against a production submission.

[#129](https://github.com/jihegao/riffology-cloud/issues/129) orders the canvas as
Model / Preview / Runs / Inspect while retaining Preview as the initial tab.
The existing experiment form now lives in Runs. Preview hands off a frozen
Revision, package identity, parameters and seed without a POST; Runs requires
explicit confirmation and preserves the original request identity until its
matching receipt is known. Standalone Preview returns to Workspace Runs with
the frozen draft. Only the current Workspace preview response enables Verify;
loading, missing availability and failed restoration leave it unavailable.
Local fixtures cover handoff, pending-request recovery, storage failures,
Workspace navigation and closed gates. This is local implementation evidence,
not deployment or authenticated server-experiment acceptance. No live experiment
or gate change is part of this delivery.

[#128 B](https://github.com/jihegao/riffology-cloud/issues/128) extends the foundation
to all product panels, dynamic notices, errors and accessibility labels, with
887 matching keys per locale. Explicit bindings retain form values, focus, user
content, iframe identity and unresolved request keys during language changes.
The copy guard removes JavaScript CJK exceptions and inventories the remaining
technical English literals. Local browser checks exercise both languages and
narrow-screen layout; exact final suite counts and CI are recorded in the Issue/PR.
This implementation is stacked after #129 and requires the same additive locale
migration. It is not merged, deployed or authenticated production acceptance.

## Private Beta definition and standing capacity

**Riffology Cloud Private Beta — 邀请制内测版**

> 面向受邀用户的受控内测版本。支持 Pi 驱动的 Python 建模、保存和本地预览；不包含生产级 SLA、权威云端实验或公开商业服务。容量在预算和安全门限内持续开放。

This is the product definition and operating contract. The implementation in
[PR #105](https://github.com/jihegao/riffology-cloud/pull/105) is merged and deployed;
[#104](https://github.com/jihegao/riffology-cloud/issues/104) owns the frozen packet,
current open/paused state, acceptance evidence, stop conditions and exit criteria.
The seven-day observation is not complete. #87 stays CLOSED / Done; its expired
window must not be reopened or extended. Current priority, status, milestone and
owner remain in the Delivery Project.

The 2026-09-20 release includes the new-tenant historical-ledger check in
[PR #109](https://github.com/jihegao/riffology-cloud/pull/109) and the independent G5
alarm stop in [PR #107](https://github.com/jihegao/riffology-cloud/pull/107).
Both PRs passed full CI; their combined M2 suite passed 834 tests. The closed-gate
release `2d216a3a-4d26-4646-a5fd-ae598f474167` was independently read back with
unchanged bindings and Worker SHA256
`c7fe8321ec59022de05a2ca93968cf63706f892cd277fb495b64f799e5b8e226`, matching the build.
The first invited submission before #109 was rejected before admission: original
Workspace and global Beta capacity both showed zero Turns/calls/reservations.
It is not paid-execution acceptance. The deployment, continuous alarm observation
and subsequent original-project acceptance are recorded in #104 and
[#106](https://github.com/jihegao/riffology-cloud/issues/106); source/CI evidence
alone does not establish them.

| Boundary | Private Beta contract |
| --- | --- |
| Supported path | Pi request → edit Python → save Revision → Browser Preview → change parameters → refresh/leave and continue. Preview is always local/unverified |
| Outside the commitment | Verified Experiment/Evidence, public signup, commercial SLA, Credits/payments and high user concurrency |
| Admission and hard limits | Accepted ordinary invitation plus active user/personal tenant/owner membership; owned personal projects inherit admission with no additional count cap. One active Turn per user across projects; global two (native Pi remains one). UTC daily 80 calls/US$2 per user, 240 calls/US$5 global; cumulative US$20. See the confirmed packet in #104 |
| Standing operation | Pi/M2 capacity remains available within approved budgets and safety limits; no per-session #87 acceptance window. Day changes and policy/project changes never erase unknown records or reservations |
| Execution safety | No automatic retry or provider fallback. Unknown execution immediately isolates the original run and pauses affected admission; use the global kill switch when scope is unknown or global controls fail |
| Operations | Capacity monitoring, fee alerts and named response owner; verify runtime/tool/container release after each terminal Turn. Unconfirmed release keeps capacity occupied |
| Historical billing | #101 independently reconciles the seven isolated historical calls, preserving their usage/fees/reservations. Historical fee uncertainty does not block normal Beta; new execution risk still pauses affected capacity. New pending fees retain reservations within explicit caps |
| Gates | Only required Pi/M2 routes may open for the allowlist: M2_TURNS_ENABLED, M2_MODEL_PROVIDER_ENABLED and PRODUCTION_MODEL_ENABLED. G5 admission, M3 cloud Preview/WS/Service and M4 Simulation remain closed; local Browser Preview does not require them |

The legacy [Pi policy parser](../services/model-budget/pi-developer-policy.ts)
remains unchanged for #87. The [standing policy](../services/model-budget/private-beta-policy.ts)
and [global capacity authority](../services/model-budget/private-beta-capacity.ts)
add persistent daily/cumulative reservation limits and cross-project occupancy;
the existing per-tenant Pi ledger remains the dispatch/terminal authority.
Implementation evidence and operating steps are in [the operating note](private-beta-operations.md).
Current invited-project admission and its reversible access revocation (#92) are
accepted against a real invitee. Paid acceptance and the seven-day observation
remain separate from local tests; none is inferred from the version name. #71's
second-principal/browser-isolation boundary is independently accepted, without
promoting local Preview to Evidence.

## Release identity

| Item | Evidence / status |
| --- | --- |
| Source baseline | Deployed application source: `1c643fceed1e6b62c3605647a99750ac1a9b3637` from the merged #130–#133 stack, checked 2026-09-23. Final code CI and independent Worker/assets readback passed; authenticated acceptance remains separate |
| PR #84 | [Merged and deployed](https://github.com/jihegao/riffology-cloud/pull/84), merge `4f564105e11dec7bac9338e770a52c57455279c9`; [Ubuntu CI passed](https://github.com/jihegao/riffology-cloud/actions/runs/35408200559) |
| #84 Gateway deployment record | `530dce72-65a6-4247-b69b-955a432188d2`, 100% at publication; PR records actual Worker byte comparison, static resource hashes and configuration readback |
| #84 execution Worker deployment record | `d5fb4b8a-d2d8-4007-b454-d97816405b22`, 100%; retained through the #90 acceptance release and observed in the authenticated Chrome/CDP trace |
| PR #86 | [Merged Pi developer implementation](https://github.com/jihegao/riffology-cloud/pull/86), merge `dc78b37`; [Ubuntu CI passed](https://github.com/jihegao/riffology-cloud/actions/runs/35421768282). #87 completed execution-isolation and core-flow acceptance; historical provider usage/billing is independent P1 #101 |
| PR #97–#100 | Merged #87 blocker inventory, exact release-hold reconciliation and private request correlation. [The latest #87 record](https://github.com/jihegao/riffology-cloud/issues/87#issuecomment-5741935018) identifies deployed Gateway version `f4da845a-96a5-42b8-bbb3-21fc18e44bcb`, exact merged source `5ac8fa5`, preserved bindings and closed execution gates. These changes expose and reconcile existing records; they do not retry, settle or replay them |
| PR #102 / #87 | [Execution isolation merged](https://github.com/jihegao/riffology-cloud/pull/102), merge `162c8917102333b2f4395abf8e07cfd5ea4cf98f`; exact append-only HMAC proof, runtime tombstone and accept/fence serialization. Production acceptance ended on Gateway version `ef30dd39-4ea0-4476-888c-8fdd1b964ecd`, 100%, with all execution gates closed and 89 bindings preserved |
| PR #91 / #90 Gateway | [Auth bootstrap fix merged](https://github.com/jihegao/riffology-cloud/pull/91), merge `c3683695`; Gateway version `ff3fae53-eeb1-4da1-824c-155cf7754268`, deployment `051de36d-4f70-4544-af4d-a3558dec6b6d`, 100%. [Authenticated acceptance](https://github.com/jihegao/riffology-cloud/issues/78#issuecomment-5740806289) records exact Queue/Mesa identities, scoped requests and before/after counts |
| Current Private Beta Gateway | Source `1c643fceed1e6b62c3605647a99750ac1a9b3637`; deployment `6a54ca89-bd48-4ddc-8fac-8ae35d834930`, 100% version `cb6935dc-dfed-4d62-8e88-8aa82215ff59`, 91 bindings preserved. Only additive locale schema plus Gateway code/assets changed; frozen Pi/M2 capacity policy and closed G5/M3/M4 gates are unchanged |
| #71 browser isolation | [Current production acceptance](https://github.com/jihegao/riffology-cloud/issues/71#issuecomment-5750074199) covers two projects, Queue/Mesa, opaque storage denial, BroadcastChannel positive/negative controls, cancel/refresh/late-message behavior, a second authenticated principal, GET-only request trace and unchanged scoped compute counts. Browser Execution remains 100% version `d5fb4b8a-d2d8-4007-b454-d97816405b22` |
| Earlier readback | [Pre-#84 allowlisted snapshot](evidence/invited-queue/release-readback-20260919.json): Gateway `0ca0acc2-fed7-43fe-9fdf-dd19d1e9b9c5`, execution `ead25cd0-74c1-43cd-b604-64dc1b8325d4`; retained as historical evidence only |
| Rollback | Freeze actual active Worker/assets/configuration before a future release; historical `727c40f` is not automatically the current operational rollback target. No database reversal or ledger reset. |

The pre-#84 snapshot had Pi/G5/model-provider/legacy-preview/simulation flags
`false`, no G5 `billingPolicy`, Managed acceptance disabled and schema-2
account-level Managed testing enabled. #84's deployment record says those
policies/gates were preserved. #90's deployment readback again found all 11
execution gates and the money policy disabled; do not extrapolate that result to a
future version.

[Pi developer mode](pi-developer-mode.md) and #86 record four original G5
unknown/pending calls without provider terminal evidence and two generic
provider-failure/pending calls. [The exact reconciliation](https://github.com/jihegao/riffology-cloud/issues/87#issuecomment-5741725933)
subsequently proved all six matching ProductTurnRuntime actors terminal/released
and cleared the six exact Workspace release holds; their request-level usage and
fees remain pending. The separate legacy OpenCode Go call now has the same
Workspace-authoritative `runtime-released` proof. All seven historical records
are execution-isolated; their provider usage, fees and original reservations
remain unchanged and pending.

#87's P0 gate was execution isolation, not supplier invoice settlement. The
seven proofs and bounded core-flow acceptance are now complete. Missing
historical usage stays in independent P1 #101 and did not block acceptance.
Never clear old reservations,
call unknown fees zero, replay a request, or use a new project, policy or window
to bypass either record. The existing developer mode uses an owner-scoped
fee-observation policy, not an invented new credit allowance.
The source manifest is a digest, not a Git commit; metadata or static assets
alone do not prove authenticated acceptance or zero cloud execution.

## Delivery gates and accountable work

| Batch / issues | Current state | Owner / exact remaining exit condition |
| --- | --- | --- |
| A: #83 | Code already on remote main; [issue record corrected](https://github.com/jihegao/riffology-cloud/issues/83#issuecomment-5736868137); historical aa interaction proof retained | Release maintainer: complete current-version refresh, narrow viewport, stale/current version and failure-state matrix before closure |
| A: #78/#90 complete; #64/#65 remain | #90 fixed auth bootstrap and #78 is Done. [Authenticated Chrome/CDP acceptance](https://github.com/jihegao/riffology-cloud/issues/78#issuecomment-5740806289) covers exact Queue/Mesa revisions/packages, embedded and independent-page runs, refresh/reopen persistence, method/origin/path trace and unchanged scoped authoritative counts | #65 still carries UI/navigation/error/narrow-screen checks. #64 retains its broader unaccepted Verify scope outside this milestone; the #78 result does not authorize or prove Verify |
| A: #71 complete | [Current production acceptance](https://github.com/jihegao/riffology-cloud/issues/71#issuecomment-5750074199) passed for two projects and a second authenticated principal; same-frame BroadcastChannel positive controls worked while cross-project delivery stayed empty. Current immutable runtime hashes matched a 37/37 real Chrome/Pyodide suite | [#71 CLOSED / Done](https://github.com/jihegao/riffology-cloud/issues/71). Preview remains local/unverified; this does not accept #64 Verify |
| A: #92 complete | [PR #119](https://github.com/jihegao/riffology-cloud/pull/119) adds reversible accepted-invite access revocation without mutating invitation acceptance, tenant, membership or projects. [PR #124](https://github.com/jihegao/riffology-cloud/pull/124) keeps the pre-revocation Session read-only and adds an explicit draft-preserving migration to a new Session. On the current deployment the real invitee refreshed into `Session 2` with the original draft editable and Send enabled; no Turn or provider/model request was submitted | [#92](https://github.com/jihegao/riffology-cloud/issues/92) owns the admission/revocation evidence; [#123](https://github.com/jihegao/riffology-cloud/issues/123) owns the post-restore conversation defect and production acceptance. Paired invitation/user audit events share request IDs; user `auth_version` advanced while the accepted invitation and four projects remained intact. Broader tenant/member/deletion lifecycle remains #93 |
| B: #87 complete; related #46/#37/#68 remain | PR #102 merged; 7/7 historical calls have exact execution-isolation proof. One bounded authenticated Turn created and saved a Python Queue model and Revision, produced a runnable Preview, retained modified parameters after refresh, and ended quiet/released. The 8/8 provider-call ceiling was reached without retry or fallback, so no second Turn was submitted | [#87 CLOSED / Done](https://github.com/jihegao/riffology-cloud/issues/87#issuecomment-5743576761), with [#103 evidence merged](https://github.com/jihegao/riffology-cloud/pull/103). Historical per-request usage/billing remains independent P1 #101; Preview is local/unverified. Standing capacity is #104; full parent issues remain later candidates |
| C: #35 | Existing publication/copy implementation; honest Queue entry added; no official Queue published | Author + distinct reviewer: ordinary author → baseline/comparison/export → submit → non-author approval → new-user copy and independent run |
| D: invited users | 0 observed participants; no research outcomes claimed | Product owner: 3 participants; all explore, at least 2 independently compare and return in a second visit; record intervention and unknown cost separately |
| #73 | Archived bounded experiment imported; decision `retain-current-runtime` | Research maintainer: preserve frozen negative result; run offline regression only; no new provider allocation |
| #77 follow-up | GitHub issue closed; complete Managed production E2E remains incomplete | Runtime maintainer: retain closed policy; model → native Experiment/Evidence → Preview/Verify → same-Session continuation requires a separate authorized run. Existing late-save/cleanup evidence does not satisfy this chain. |

The #78 closeout covers one authenticated target account and both frozen Queue/Mesa
projects. #71 subsequently added current-version two-project storage/channel probes,
a second authenticated principal, current request traces and unchanged scoped
compute counters. #92 now adds real-invitee admission, reversible access revocation,
session invalidation, paired audit evidence and an explicit migration from the
read-only historical Session to a new current-principal Session. Distinct author/reviewer identities
remain required for official model publication.

## Next execution packet

1. Start from the Project's current milestone, [Pi online recovery and core-flow acceptance](https://github.com/jihegao/riffology-cloud/milestone/1).
2. Pi track: [#87](https://github.com/jihegao/riffology-cloud/issues/87) stays closed. Complete [#104](https://github.com/jihegao/riffology-cloud/issues/104)'s deployed Private Beta acceptance and observation; operate only within its frozen limits after new execution risks are resolved. The expired project-specific acceptance window is not a standing production policy.
3. Historical provider usage and fee reconciliation continues only in P1 #101. Do not retry, settle, refund or rewrite the seven original records.
4. Acceptance track: #78/#90/#87/#71/#92 are Done; select one of #83/#65 as capacity and dependencies permit. At most one Pi standing-capacity task and one deployed-feature acceptance task are active. Record deployment/model identity, steps, results and remaining gaps on the issue.
5. #35's first official Queue case, #75 email access and #85 skills are the next batch after the core path stabilizes. Other broad architecture/commercial tasks remain candidates; #73 retains its archived decision.
6. Use [the Queue research protocol](invited-queue-research.md) and [acceptance ledger](evidence/invited-queue/acceptance.json) when that phase is reached. Missing observations stay `null`/pending. Existing [local validation](invited-queue-delivery-validation.md) and [branch dispositions](branch-disposition-20260919.md) remain historical references.

CI runs local checks with no cloud/provider credentials. It cannot close A–D by
itself. Do not use closing keywords for issues whose own exit conditions remain open.
