# Current release readiness — 2026-10-14

## 2026-10-16 04:47 UTC PR223 frontend deployed; authenticated acceptance pending

The frozen PR223 frontend (`f625f019`, product source unchanged from the tested candidate; PR225/226 excluded) is deployed at 100% in version `d845ffab-7a7d-4c50-a68d-96bac49a2a9a`. Normal Wrangler reauthentication used only existing scopes; all nine missing assets uploaded, and all 95 public asset bodies match frozen hashes. Exact backend, 99 bindings, 23 SQLite exports and five container associations are preserved. Manual-save policy remains absent/default-disabled, G5/M3/M4 remain closed, and existing M2 gates are unchanged. Real ordinary-owner and second-identity acceptance remain pending; no project/save/provider execution occurred. [Release and next acceptance boundary](manual-save-restricted-production-20261016.md) · [online asset evidence](../evidence/releases/manual-save-frontend-assets-readback-20261016.json).

## 2026-10-16 Manual-save compatible backend deployed, admission closed

PR #223's compatible backend is deployed at 100% as `bb6de79c-10d3-4646-97d3-fc5791bb481c` (deployment `70c7bfe5-2cb4-4766-9f99-5c8ec91219f6`, 02:50 UTC), with exact module hash readback and all existing bindings/exports/container associations retained. Migration 0013 is installed; old table counts/schema are unchanged, and the new fence table is empty. Manual admission remains absent/default-disabled; G5/M3/M4 remain closed.

The existing 92-file frontend is retained. Uploading the nine changed/new candidate assets returned 401, so the new manual-save frontend is **not deployed**. Public static reads returned 403; no page or authenticated acceptance is claimed. Independent review of ca3b2b4 found no must-fix. Applicable check components passed (3131 Node, 13 skips, 8 Python), plus two reproducible retention regressions and typecheck. Real ordinary-account/new-project scope, a precisely scoped disabled fallback and two-account acceptance remain pending. [Release and stop/migration requirements](manual-save-restricted-production-20261016.md) · [evidence](../evidence/releases/manual-save-restricted-production-20261016.json).

## 2026-10-15 Manual-save candidate and real login preparation

PR #221 adds a loopback-only workbench manual-save candidate: explicit manual Revision provenance, one canonical head shared with Turns, user-upload artifacts consumed by the read-only page broker, and original-operation recovery. D1 fencing coordinates publication with invitation revocation. [Interface and recovery semantics](manual-project-save-design-20261015.md) include the remaining GC/purge scope; these changes are not deployed.

The frozen candidate passed full local `npm run check`: 3,124 Node passes, 13 skips, 8 Python passes; two cross-reviews found no additional must-fix. [Candidate evidence](../evidence/releases/manual-save-candidate-20261015.json) records source hashes, prior failures and identity/environment gaps. This does not turn the remote empty CI failure into a pass.

The designated local operator completed real Google OAuth in a separate local Catalog. Invitation activation and the ordinary invited account's project/save/page/revocation chain remain pending. Prior AMD128 page/egress results used synthetic identities and do not satisfy this missing acceptance. Draft, unmerged, `productionEligible:false`, production disabled; no model or cloud-compute acceptance is claimed. The historical suite counts below describe their original revisions, not the new manual-save candidate.

## 2026-10-15 Generic pages: real package/broker isolated-host integration passed

PR #221 now replaces the application iframe with a PNG canvas client and a local isolated Chromium host. The canonical package, original authorized broker and real MessageChannels are connected. AMD128 verified file/artifact reads, canvas rendering, click/keyboard/fractional-wheel input, page switching, revocation cleanup and nine failed egress attempts with collector positive controls. Original-ID cleanup is confirmed; no labeled containers remain. [Implementation and reproduction](project-view-isolated-host-20261015.md) · [exact-source evidence](../evidence/releases/project-view-isolated-host-20261015.json).

Full local `npm run check` exited 0 (3,077 Node passes, 13 skips, 8 Python passes); final worker/host checks 11/11. This supersedes the earlier synthetic-only integration gap below. Production dual-loopback gates remain closed, the old local generic-frame endpoint returns 410, and no deployment/provider/cloud-compute calls occurred. Draft review and production authenticated/cloud acceptance remain outstanding; #214/JHG-46 are not Done.



## 2026-10-15 AMD128 isolated Chromium: local synthetic chain passed

[PR #221](https://github.com/jihegao/riffology-cloud/pull/221) now includes an actual offline browser chain and reviewed per-container seccomp policy. Chromium153 / Playwright1.63 on AMD128 passed rendering, trusted mouse/keyboard input, nine real page network attempts blocked, host collector positive controls, actual Docker config inspection and exact-ID cleanup. An intentional SIGTERM also confirmed cleanup. [Versioned evidence](../evidence/releases/amd128-isolated-chromium-20261015.json) retains failed setup attempts and scope limits. Static/injected checks13/13 passed; no new full-suite or production claim.

Production generic pages remain disabled. This validates the synthetic isolated-browser boundary; it does not replace the current iframe in the product or deliver real package/broker, user transport, revocation, image decoding or cloud lifecycle. No deployment/provider/paid execution occurred. PR remains draft and #214/JHG-46 remain blocked on production integration and acceptance.

## 2026-10-15 Draft #221: project resources and isolation repair candidate

[PR #221](https://github.com/jihegao/riffology-cloud/pull/221) is an unpublished-runtime candidate: no merge, deployment or authenticated/paid acceptance. Trusted Pi resources now have a Managed explicit-command counterpart, frozen into the original input digest with bounded resource-text saving. This is not autonomous model-side lazy loading or full Pi backend equivalence.

Repair commit `73d923b9cd9ff10ab4180736990e46937e2d48fd` passed the complete local check (13 skipped): UI 21, M0 353, M1 549, M2 985, M3 1105, issue73 30 and research-quality 8. The execution worker's generic-page gate now requires both app and execution origins to be loopback, matching Gateway's independent check. Three synthetic navigation cases still reproduce the original iframe egress defect; production page delivery remains disabled.

The user approved preserving arbitrary JS and developing an offline isolated-browser prototype, without deployment or cloud charges. [Prototype scope](project-view-offline-prototype-20261015.md) separates its local launcher/fixtures from real browser-image, container-policy and production acceptance. The original October 20 target requires reassessment after evidence; no replacement date is promised. AMD128 independently checked the repair tree: Managed 188 and pages/prototype 32 passed. Its original full baseline invocation failed one release-ACK observation race; a fixture-only correction passed individually on both hosts, without rewriting the failed full invocation. The prototype cleanup follow-up passed 11 injected tests and a real failed-container cleanup; the native network-only probe passed, but no isolated Chromium acceptance is claimed. [Final evidence](../evidence/releases/m1-repair-amd128-20261015.json) separates each tested version.

## 2026-10-14 Main integration deployed: candidate design, unchanged answers and section views

Main `eba528f7b101a67f32565e4aac74a0d4154a7dec` is deployed to [app.riffoid.com](https://app.riffoid.com): Gateway `d9ceec61-1e5f-48cc-8a51-3abdb4b06614` and Entry `5869db28-cb18-4bcc-8e2a-7364e8c888ce`, both at 100%. PRs #169 → #170 → #173 reconcile the current Beta deadline, branding and signed domain source; #198 design/answer/subtabs and #200/#203 receipt/reviewed-copy fixes are all retained. #204 adds acceptance evidence without changing production code.

Exact module readback and all 92 static assets passed. The release preserves 99/6 Gateway/Entry bindings, 23 SQLite exports, five container associations, all 15 account container configurations and eight Preview runtime profiles. G5/M3/M4 remain closed; no maintenance-validation configuration was enabled. Local final M2 961 and M3 957 passed, with the remaining suite results and conditional skips recorded in the [release note](main-integration-release-20261014.md) and [sanitized evidence](evidence/releases/main-integration-release-20261014.json).

The #182 core slice is now deployed and remains Acceptance for a fresh authenticated invited-user test of design persistence/restoration, unchanged answers and shared tab state. This release initiated no provider or simulation acceptance. Browser Preview stays local/unverified, and full SysML semantic validation remains outside the implemented subset. Fire's independent acceptance is bounded to its own versions and identities below. Cleanup preserved original dirty work, unique history and active task branches. Delivery Project fields remain unsynchronized because the restored token lacks Project scopes; Issue/PR/Linear carry the evidence.

## Later main integration observed after Fire acceptance (read-only continuity)

A separate main integration replaced the Fire acceptance deployment at 2026-10-14 08:53:29 UTC: Gateway `d9ceec61-1e5f-48cc-8a51-3abdb4b06614`, deployment `54f253dd-c7b3-4407-867d-b9856642c1ff` at 100%, reported source `eba528f7`. Read-only module observation found SHA `141ee79098a0ed3f799f2fb2c9f5dde3ba65a2d73317227f9e15b1037077d41a` / 5,795,550 bytes, retaining reviewed-copy admission, readiness and the second-Run fence. Original copied-Run terminal/release and scoped 0-provider/1-native counters are retained, with no occupied/unknown quota. No native execution was repeated on this later version. The #202/Fire entries below are acceptance-time snapshots; broader main-integration and design/v3 acceptance remains separately owned.

## 2026-10-14 Reviewed-copy first native Run deployed and accepted

[#202](https://github.com/jihegao/riffology-cloud/issues/202) / [PR #203](https://github.com/jihegao/riffology-cloud/pull/203) removes the unrelated provider Turn prerequisite for the explicitly authorized reviewer’s own new published copy. The narrow Managed schema2 path persists one Run id, rechecks the current reviewer/owner/source/authVersion/policy, rejects a second distinct Run and preserves unknown/cleanup isolation. It does not change Private Beta invitations or routing.

Gateway `9f472694-4aa5-4f0f-8fda-ceddd02e1e88`, deployment `0dbc1645-cba0-4db0-bb87-ace9ce0e119a` at 100% during this acceptance, served frozen live composite `e422b297e75b8ee1f32caaa43e0d451a5f7a95d9`. Module SHA `517ce37d817efa0f3e17d1add49fadb5e30c91b68d0465dd2ddb40737ffb1818` matches live readback; settings, 99 bindings, 23 SQLite exports, five container associations and asset configuration are preserved. This repair deployment carried no main design/v3 slice. A separate main integration subsequently replaced it; see the observation below.

One ordinary UI Run of the published Fire copy completed and released, with the expected five metrics. Scoped counters show zero added provider Turns/Sessions, one native Run and no occupied/unknown tenant lease. This is the designated Managed operator/reviewer scope; a third ordinary non-operator copy is untested. Native cloud fees remain unknown. The one distinct native-only Run allowance is now consumed; this acceptance does not authorize a second Run.

New Workerd 3/3 and live focused/adjacent 54/54 checks passed, as did typecheck and diff checks. The M2 run passed 961/961; it started before the final readonly marker tightening, after which the new Workerd/typecheck/diff checks passed again. Independent code review found no must-fix. CI quota was waived by the user and is not recorded passed. See the [release note](managed-reviewed-copy-release-20261014.md) and [sanitized evidence](evidence/releases/issue202-managed-reviewed-copy-release-20261014.json).

## 2026-10-14 NetLogo Fire published for noncommercial Private Beta

[#196](https://github.com/jihegao/riffology-cloud/issues/196) completed the bounded ordinary-author comparison, different-account frozen-export review, publication, ordinary UI copy and one copied server Run for `netlogo-fire-python-beta@0.1.0`. The copied Run used the authorized Managed operator/reviewer native-only first-Run path delivered by [#202](https://github.com/jihegao/riffology-cloud/issues/202); it is not ordinary Private Beta invited-owner acceptance. All six comparison Runs completed and released; the copied baseline Run also completed and released. The platform-repacked copy archive differs from the author's frozen archive, while the six candidate files and Spec match. Scoped counters show zero added provider Turns or Sessions and one native Run; usage and fees remain unknown. A third ordinary non-operator copy-and-Run identity was not tested.

This remains an invitation-only, noncommercial CC BY-NC-SA 3.0 Beta case. Browser Preview is local/unverified; native NetLogo equivalence, scientific gold and Verified Experiment/Evidence are not claimed. CI quota was waived by the user and CI is not reported passed. #136 broader acceptance remains unfinished and #35 Queue scope is unchanged. See the [release note](netlogo-fire-publication-20261014.md) and [sanitized evidence](evidence/releases/netlogo-fire-publication-20261014.json).

## 2026-10-14 Read-only tool receipt deployed and owner read accepted

[#199](https://github.com/jihegao/riffology-cloud/issues/199) and
[PR #200](https://github.com/jihegao/riffology-cloud/pull/200) add a narrowly
scoped owner read for persisted tool-request terminal evidence. Gateway version
`3789df91-afc5-4e89-8ea7-1dbe7a88036f`, deployment
`1a8687ad-a7a5-42a8-a6e5-295ba1b1805f`, was at 100% for this receipt acceptance.
The later #202 release above supersedes that deployment. A later ordinary-author
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
group under [#196](https://github.com/jihegao/riffology-cloud/issues/196) was
outside #199 acceptance. Its later completed/released comparison, publication and
authorized copied Run are recorded in the Fire entry above; #199 itself does not
claim that result or formal Experiment evidence.

[Release note](tool-receipt-release-20261014.md) and
[sanitized evidence](evidence/releases/issue199-tool-receipt-release-20261014.json)
record the exact source/deployment identity, authenticated read boundary and
remaining gaps.

## 2026-10-14 Candidate design artifacts, section views and unchanged answers (implementation snapshot; subsequently deployed)

[#182](https://github.com/jihegao/riffology-cloud/issues/182) / Linear JHG-22 is the selected implementation slice. Candidate v3 separates `answer`, `design` and `model`: answers create no Revision; design documents, SysML text and declarative graphs overlay the frozen base; computation retains the existing v2 validation. Model, Preview and Runs consume a bounded display manifest with one level of platform-owned subtabs. Tabs preserve the loaded package, inputs, playback and historical record identities without creating execution requests.

The [current minimal contract](requirements-revision-artifact-contract.md#candidate-v3) distinguishes this implemented subset from the remaining requirements/traceability, full SysML semantics, modules and runtime proposals. Source is based on main `957b579fbb9f8cb79a9092605d50094ee6a64dbb`. At the implementation capture, no production gate or original user Turn was changed, no request was replayed, and deployment/authenticated/paid acceptance were not claimed. The main-integration entry above now records deployment and static verification; authenticated acceptance of this feature remains pending. Validation: typecheck and UI (21) passed; M0 passed 350 with one conditional skip; M1 passed 290; M2 passed 943; M3 passed 949 with 12 conditional skips, plus runtime/execution 20, phase checks 13 and model checks 92. Archived-experiment checks passed 30 and Python research-quality checks passed 8. Focused checks additionally cover opaque archive/mode preservation, the final Managed integration and bounded research context. Local execution used Node 26, Chromium and OpenSSL 3; the initial Node 25 M0 timeout/LibreSSL TLS failures were isolated and resolved by those local tool selections. GitHub CI uses its configured environment and is reported separately in the PR. Review entry and exact source head are recorded in the implementation PR and #182.

The implementation PR is [#198](https://github.com/jihegao/riffology-cloud/pull/198). Main `a40248a4614d0cba9c0dbdb0637022d1becb8433` was subsequently integrated, preserving the NetLogo intake record below; production source files did not overlap. All seven newly merged NetLogo candidate checks passed against the combined tree. M1 used Node 25.3.0; the other final suites used Node 26. [CI run 38492300904](https://github.com/jihegao/riffology-cloud/actions/runs/38492300904) failed before any step (`runner_id=0`, `steps=[]`), with no downloadable log. Its failure annotation was not accessible through the available connector. The account blocker recorded for the earlier NetLogo CI run below is a relevant lead, not a verified diagnosis of this run. Hosted checks did not execute and are not reported as passing. On 2026-10-14 (Asia/Shanghai), the user identified exhausted GitHub quota and explicitly waived this failure for continued delivery. The quota failure no longer blocks this PR; no retry or account settings change was performed.

The final pre-merge review reproduced and fixed JSON array coercion in design enum/source/edge validation and v3 accounting operation classification. Three new regression cases failed before the fix and pass after it. The final full M2 suite passed 946 tests with no skips; focused candidate/dispatcher checks passed 83, view/Preview/research checks passed 21, and typecheck plus whitespace checks passed. Earlier M0/M1/M3/UI results above remain the recorded full-suite evidence; they were not redundantly rerun for this bounded validation fix.

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

2026-10-11 18:08 Asia/Shanghai：[正式配置切换及最小登录/项目检查](evidence/riffoid-direct-cutover-completed-20261011.json)。用户批准固定继续包 `22dfc77d…0991` 并保持独占发布后，仅发出 entry、Gateway 恢复配置两次各一次 PUT；196 次调用端配置 GET 全部完成，发布后 entry 22 GET、Gateway 36 GET 完整读回通过。entry 当前 `668e19e6-6f23-49e0-b4f6-06459790a496`（6绑定），Gateway `2227852e-2802-40e9-92e4-0a1b4ff8aab9`（99绑定），Execution 保持已独立确认的 `3e96532e-dbeb-4c8c-b147-7e71939b0472`（4绑定），三者原代码和原日志配置保留。实际入口发布读回时间 T 为 `2026-10-11T10:03:41.535Z`，旧入口只读原记录恢复截止 `2026-10-13T10:03:41.535Z`（北京时间10月13日18:03:41），并非自动回退旧业务。

新入口 https://app.riffoid.com 已开放；原有 Google 身份在原生 Safari 完成一次正常登录，项目列表及现有项目「22」/原 Session 1 读取成功，随后返回项目列表。没有点击 Send/Run、创建身份/项目/Session 或恢复归档；没有收集账号级权威执行计数，故不宣称全局零执行/费用。该项目原模型显示尚未通过运行检查，未运行模型。这只是单一身份/项目的最小 UI 检查，身份角色/邀请路径、完整 A/B、第二身份/权限隔离、SSE、Browser Execution、付费执行、实际48小时到期与旧记录访问均未验收。上线状态 **尚未验收**；PR #173保持 draft/open、Project Acceptance/P1、M1、负责人jihegao，不标Done、不关Issue。原待决定阻塞已解除；#175最小源码修复继续 In review/P1，未合并/未部署。

本轮控制器正常 exit0、pending为空，未使用回退、无新未知；原五份历史未知及原停止会话锁经哈希核对保留，原 PUT/A/B/Observe/Run/cleanup 均未重试。完整资产字节/集合、平台遥测排空及代理内部 HTTP 尝试次数仍不作成功声明。本条为当前状态，下方按时间保留历史记录。

2026-10-11 17:30:27 Asia/Shanghai：[直接切换中止及独立确认](evidence/riffoid-direct-cutover-partial-20261011.json)。用户取消完整 A/B 并选择直接切换，状态“尚未验收”。Gateway97绑定已发布/完整读回；Browser Execution一次PUT收到响应，但原严格检查因平台只读 `annotations.workers/triggered_by` 从 `version_upload` 变为 `upload` 停止，控制器已退出，原未知记录和锁保留。随后5原生GET定位注释差异，再78个GET完整独立确认三个当前Worker的代码、可写配置、namespace/容器及资产保留合同。Gateway当前 `34969c4a-d82c-4092-b026-33491dea789c`；Execution `3e96532e-dbeb-4c8c-b147-7e71939b0472`；entry `7c04a21d-c95a-4a4c-a6b8-e21282fdc1f0` 仍disabled。新业务未开放，旧完整应用中断，T/recoveryUntil仍空，登录/项目最小检查未启动。原5份历史未知保留；平台注释确认不代表业务健康。

当前阻塞是用户此前保留的“未知后另行批准”决定：固定继续包已准备，仅需entry与实际T+48h的Gateway两次发布；或两次恢复旧Gateway/Execution。20项离线发布边界及实际99绑定multipart/只读注释处理检查通过；新scope尚未执行。不会重试原PUT、重跑A/B或清理记录。PR #173保持blocked，#175源码修复In review/P1；不标Done、不关Issue。

2026-10-11 17:00:55 Asia/Shanghai：[两份 Observe 403 与完整恢复证据](evidence/riffoid-origin-denied-recovery-20261011-66559c.json)。本轮两次维护发布后，电脑 Safari 与手机各一次 Observe 明确返回 `403/origin_denied`，Run/entryReady/cleanup 均未发起；单独批准后的四次各一次恢复全部通过完整读回，原 Gateway/entry 代码、95/5 绑定和日志已恢复。Gateway 当前版本 `7467fa4a-dc57-4178-aae0-ee5fa00db6be`，entry `7c04a21d-c95a-4a4c-a6b8-e21282fdc1f0`；Browser Execution 本轮未发布或重读。四份历史未知记录保留，没有新未知发布。403 定位于验收页 `no-referrer` 在 Safari 的同源 POST 将原生 Origin 变为 null；最小 `same-origin` 修复与夹具校正进入 PR #173/#175，19 项相关测试、类型检查及 2 项本地 Workerd 回归通过，尚未部署或完成线上验收。

用户随后明确允许取消完整 A/B 验证、改为直接切换；后续发布状态必须标为**尚未验收**，先准备正式配置及旧入口回退，切换后至少确认一次现有登录和项目访问。此前双网络协议和第二身份/空闲 Session 不再作为直接切换前提，其未覆盖范围保留。当前尚未正式切换，T/recoveryUntil 仍为空；普通业务健康仍未知。完整资产集合、平台遥测排空、账号全局零执行/费用均不作成功声明。

2026-10-11 16:03:42 Asia/Shanghai：[零发布预检停止与完整只读核对](evidence/riffoid-native-preflight-20261011-c100.json)。`80e5ed67…b0c10` 获批时已不足以完成预检，未启动；获明确批准的 `6a6c6069…7eefd` 在第二次原生 Worker 清单 GET 超时后停止，32 次 GET 发出、31 次完成，首次 PUT 前失败，无 intent/unknown 写入，进程已确认退出。独立诊断随后完成 Gateway 36 次 GET（约 87 秒）及 entry 22 次 GET（约 59 秒），前后原生部署/版本、源码、完整配置、资源和日志管道核对通过；仍为原恢复版 `6d580077…202135` 和原 entry `c110d7a7…7fff`。本轮 PUT／A/B Observe／Run／cleanup 均为零；原四份 unknown、历史数据及日志设置保持。超时原因未确定，keep-assets 不代表完整资产审计，不宣称平台遥测排空或全局零执行/费用。取消的包与配合时段不复用；后续必须留足逐阶段完整读取时间。协议及真实第二身份／已有空闲 Session 验收仍 pending，正式 T/recoveryUntil=null。

2026-10-11 15:07:51 Asia/Shanghai：本轮新恢复批准已执行。原 Gateway 代码、95 个绑定和原日志已恢复，版本 `6d580077-1042-4242-9ca5-665008202135` / deployment `be951946-ead9-4da9-814f-d493d2d13520`。两次原生 PUT 分别应答 5.127 秒和 6.104 秒，各一次、零自动重试/重定向；前后完整独立读回通过，临时维护配置已移除。原四个 unknown 及锁保留，本轮验收不重跑。后续部署/版本身份列表已限定为原生 GET，6 项边界检查及八阶段零网络模板检查通过；配置清单仍使用原严格解码范围，未扩大写入或权限范围。最初读回不一致的传播/读取原因仍未确定。资产字节与平台内部遥测排空未证明，用户接受恢复日志后可能保存迟到遥测。域名切换及真实 A/B 协议尚未验收，正式第二身份和既有空闲 Session 仍缺失；T/recoveryUntil=null。[本轮恢复与读取修复证据](evidence/riffoid-native-maintenance-20261011-5599.json)。

2026-10-11 14:56 Asia/Shanghai 本轮记录：Gateway 单次原生 PUT 在 6.294 秒应答，随后 deployments 的 active 与 versions 的 latest 不一致，控制器立即停止并保留原 intent、unknown 和锁。另一次仅 GET 的完整核对确认临时维护版本 `ef94e323` / `2461c5da` 已生效、日志持久化关闭，既有资源保持。Entry 与 Browser Execution 未发布；A/B Observe、Run、cleanup 均未发起。本轮不重跑。两次各一次的原 Gateway 恢复载荷已冻结并离线核对，计划 SHA `ee5ce9366d1ddf5c902184e92f2fe1b037ae4f99b078051819a9bc8d88688276`，恢复尚未发出 HTTP，需本轮新批准。平台内部遥测排空及资产字节未证明；恢复日志可能保存迟到遥测。[本轮停止、只读核对与恢复包证据](evidence/riffoid-native-maintenance-20261011-5599.json)。正式切换未开始，T/recoveryUntil=null；第二受邀身份与既有空闲 Session 仍缺失。

Earlier October 11 preflight (before the 14:56 record above): the frozen five-minute round stopped before durable intent or PUT because the native Zone-ownership GET exceeded30 seconds. The original Gateway and logging remain restored; no server maintenance configuration or browser protocol operation was published. The exact configuration/identity GET router is repaired, with6 boundary checks and two actual decoded Zone-ownership readbacks passing. Source/module evidence and every PUT remain native. See [preflight and routing repair](evidence/riffoid-zone-reader-preflight-20261011.json). The user currently has no second invited identity without target-project permission or existing idle Session for the agreed formal acceptance; these observations remain pending. Fresh phone cooperation is requested before another window. T/recoveryUntil remain null.


## 2026-10-11 域名切换续作：恢复后完整预检及固定载荷（未开启）

原 Gateway 与原日志恢复后，Gateway、Entry、Browser Execution 均已重新完成源码、完整绑定、资产保留合同、关联资源和前后部署身份读回；当前版本分别为 `a00f97bc`、`c110d7a7`、`c94df077`，绑定数为 95/5/4。两 zone WAF、Managed Transforms、Pseudo IPv4 与 ruleset/snippet 元数据也已重新读取。原三个 unknown 记录及其锁保持原样，当前配置读回不改写历史请求终态。

正式切换和失败关闭/前向恢复共七份固定载荷已离线准备，使用三个当前线上模块的原字节；Gateway 切流为 97 绑定、Entry 为 6、Execution 为 4，T 和恢复期限仍为空。包 SHA `c2d84bdbf75122886e426064003ae2275dc89a6791c46c0245c82dfacf35a0bf`；未将未发生的 T 写入恢复配置。维护控制器新增严格 GET-only 部署/版本列表解码桥，源码/配置/版本详情仍独立原生读取；PUT 单次原生传输不变。相关 52 项检查及八阶段零网络/零写入模板检查通过。完整资产字节/集合、平台内部遥测排空和 proxy HTTP 尝试数没有据此证明。

本次准备没有新增生产写入、开启维护窗口或发起协议/模型/Turn/Run。真实双网络协议和认证新域验收仍待完成，PR173 保持 draft/unmerged，T/recoveryUntil=null。[完整基线、固定载荷摘要及证据边界](evidence/riffoid-post-recovery-preparation-20261011.json)。


正式控制器已补齐三步激活与已知失败的入口关闭/前向恢复队列；19 项真实文件 journal 的离线检查通过，覆盖重复/并发提交、失去写回执、入口顺序和后台漂移。固定载荷仍未 armed，正式 live 会话、协议后完整部署守卫及真实验收范围待落实。域名/证书与三 Worker 别名均已只读核对；仅 Execution 保留原 workers.dev 地址，新账号凭据完成原五项权限续期。

当前容量快照 active/quarantined=0/0、meter-only、pin `695cdd9e…`、reviewAt=2026-12-31；#104 顶部及 PR169 确认该期限为 10 月 7 日已批准并完成的续期。10 月 20 日是历史容量期限，M1 截止仍为 10 月 20 日。容量策略本次未改，快照仅覆盖 Pi 账本。手机实时配合及认证验收资源待回复，本轮仍无新窗口或生产发布。


## 2026-10-10 15:45 UTC original Gateway restored; domain cutover pending

The [approved original-write recovery evidence](evidence/riffoid-original-write-restored-20261010.json) confirms the original Gateway module and all95 bindings,23 SQLite exports,5 existing container associations and frozen asset-retention contract after two recovery PUTs, each dispatched once. Temporary validation configuration is removed. Original observability is restored, including logs.persist=true, traces disabled, logpush=false and empty tails. Current Gateway version is a00f97bc-f0da-4e04-97b0-8f96f0a26a89, deployment d78a6f03-2552-4076-8ad5-7abd1802654c; independent bracketed GET readback completed at15:45:27.679 UTC.

The privacy restore PUT reached its deadline; GET reconciliation confirmed it applied. The approved logs restore returned success after6.142 seconds, but its initial post-write version GET timed out; a separate complete readback subsequently confirmed the restored state. All three intent/unknown pairs and locks are retained. No original unknown is converted into a terminal receipt, no PUT is retried, and the old protocol window remains stopped. The explicit two-write approval accepted possible late persisted telemetry; platform drain is unproven. Asset preservation meets keep-assets-contract-v1; complete asset-set identity and bytes are not audited.

The reviewed logs-only continuation is in234e078661ff4d3f699ef84999ac62ea53cb7de3; live-adapter/recovery checks pass52/52. Entry and Browser Execution receive no writes in this recovery. Domain cutover, two-network protocol verification, authenticated new-domain acceptance and formal T/recoveryUntil remain pending. No model, Turn or Run request is initiated, and no global zero-execution claim is made. Earlier sections below are dated historical snapshots, including the earlier pending-recovery approval.

## 2026-10-10 PR173 MIME bytes and method-specific retry boundary

The publisher now parses raw MIME bytes for modules with or without filename, preserving exact source hashes and line endings. Manual redirects are explicitly rejected; missing/duplicate entrypoints, modules, malformed boundaries and truncation fail closed. Local seven suites pass127/127 with typecheck/diff checks. The [contract and evidence](evidence/riffoid-mime-readback-20261010/mime-and-retry-contract.md) supersede the prior inference that the authenticated execute sandbox lacks raw responses: a historical original-Gateway GET supplied exact byte/header/digest evidence, without certifying a complete fresh baseline. This implementation/review round performs no new production GET/PUT or experiment.

Two fixed official proxy versions and20 offline injections confirm method-agnostic 429/network retry, including PUT; actual deployed proxy version remains unknown. Following independent method review, read-only GET can be accepted with bounded caller observations and deployment/latest/settings/resource brackets. Inability to disable GET retry is not an absolute deployment blocker. All actual PUTs through the current raw adapter are blocked before dispatch until every-layer non-replay is separately established; SDK/metadata bridges are GET-only. Caller timeout is not proof proxy work stopped. Fresh complete baseline, actual container association readback, original run/window inputs and operational coordination remain pending. Existing approved terminal/late-telemetry handling and asset retention contract stay intact. CI remains unverified under the user-confirmed quota decision. No deployment or Done claim.

## 2026-10-10 PR173 asset retention gate — independently accepted offline

The `keep-assets-contract-v1` gate now distinguishes existing asset-set retention from routing configuration readback and complete content auditing. Every upload requires keep_assets and rejects explicit assets metadata and reserved asset-config modules. Both Workers freeze scope, inventory presence, bindings and the three configuration-evidence states; publisher/coordinator/restart checks recompute the same contract and retain namespace/container/module/pipeline/unknown/deadline guards. For a Worker with assets, preservation can pass while full-state/byte coverage remains false. No live execution is authorized by this change.

[Standard and exact boundaries](evidence/riffoid-asset-contract-20261010/asset-retention-standard.md), [current summary](evidence/riffoid-asset-contract-20261010/summary.json) and [independent review](evidence/riffoid-asset-contract-20261010/independent-review.json) record 105/105 local and independent fixtures, typecheck, matching seven source hashes and extra counterexamples. [Retained failed and successful logs](evidence/riffoid-asset-contract-20261010/retained-checks-index.json) remain available. This pre-push snapshot is frozen; PR173 records the resulting published commit. The prior P2 repair was published as `a5adf902245f`; older unpublished/pending-standard descriptions below are historical. User confirmation at 09:10:29 UTC identifies GitHub quota exhaustion as nonblocking for this push; CI remains unverified, with no rerun or workflow/protection change.

[Original authenticated HTTP path and integration options](evidence/riffoid-asset-contract-20261010/raw-http-integration.md) distinguish actual connector authentication from missing raw-response/client exposure. Both original links authenticated; decoded metadata can support semantic configuration checks, but module integrity still requires raw or documented lossless module bytes/names plus authoritative entrypoint. Current version schema lacks assets configuration and containers: absent assets configuration is honestly unverified, while actual container association evidence remains a live blocker. Fresh baseline, publisher coordination and exact run/window inputs are deferred to deployment preparation. Complete asset bytes remain a separate unperformed audit. Application terminal evidence and late-telemetry handling use the existing approved risk record; no absolute platform drain is reintroduced. Original migration was reported stopped at 22:13 UTC on October 9; it is not reopened or replayed. No deployment, window or experiment was started.

## Historical P2 preparation snapshot — superseded by the asset gate above

### 2026-10-10 PR173 external P2 repairs — frozen pre-push evidence

External review of published head `6acdc30dd222` found namespace pagination, completed-chain restart and cross-page cleanup safety gaps. Earlier internal no-P2 results do not accept these new findings. [P2 repair evidence](evidence/riffoid-release-preparation-20261010/p2-repair-summary.json) records the current offline fixes, retained initial failures and 97 passing fixtures/typecheck and independent no-P1/P2 review of the frozen source hashes; [all prior/current check logs](evidence/riffoid-release-preparation-20261010/retained-checks-index.json) are now locally traceable beside their corresponding historical summaries. This round is not pushed or deployed.

Cleanup is unarmed by default. The operator must have the coordinator verify both original Run receipts, then authorize it once in the original A page. Unknown on either side means Stop both original pages; Stop is local and makes no new RPC or server-termination claim. Completed publication chains can be reconstructed with GET-only current readback; unknown markers outrank terminal files, and unowned/invalid locks are never cleared automatically.

The one explicitly approved [G5 summary comparison](evidence/riffoid-release-preparation-20261010/G5-summary-readback.json) returned equal 4919-byte parseable JSON hashes for settings and fixed version `6edef49b`. The previous truncated projection is superseded for this field; complete Worker baseline acceptance is still pending. [Assets contract versus full-content audit proposal](evidence/riffoid-release-preparation-20261010/assets-acceptance-design.md) awaits explicit standard approval; asset-dependent publication remains blocked. Readback repeats namespace/container/pipeline evidence and brackets both accounts; lost or replaced locks and deadline expiry after the final ownership check fail closed. These checks do not create an atomic multi-endpoint snapshot, so external exclusion remains necessary. The old frozen v2 entry candidate does not contain these UI repairs; a fresh source-matched entry bundle exists for offline review only.

## 2026-10-10 PR173 technical follow-up; live publication still blocked

The scoped read-only adapters implement account/owned-zone Logpush inventories, exact-script tails, paginated observability destinations and container application listings. Existing application identity, pinned configuration digest, Worker export and DO namespace association are checked. The publisher brackets all resource/pipeline reads with final settings, script settings, deployment and latest-version reads; any drift blocks publication. A caller-authenticated official SDK raw Response bridge disables retries. Decoded connector metadata is distinguished from raw HTTP headers/body evidence.

[Technical evidence](evidence/riffoid-release-preparation-20261010/technical-follow-up.json) records 74 passing offline fixtures, successful typecheck and [27 independently reviewed fixtures](evidence/riffoid-release-preparation-20261010/technical-independent-review.json). Actual GET observations found all eight selected pipeline inventories empty and verified both zone owners. Five fresh application configuration digests associate with retained earlier Worker metadata; this mixed-epoch check does not certify the current complete baseline.

Gateway assets remain incomplete: `keep_assets` and asset configuration matching prove the preservation contract and configuration only, not every asset byte or asset-set identity. The existing connector does not expose raw HTTP receipts or an authenticated SDK client. Complete fresh baseline and namespace/resource snapshots remain pending. The G5 projection discrepancy is awaiting the parent thread's requested approval; it was not retried or read through an alternate route. Full-state coverage remains false and every live PUT stays blocked. Run/time/visitor inputs remain null. Production writes and provider calls are zero; the original dirty checkout is untouched. Earlier preparation/CI failure evidence remains historical and is not promoted to live acceptance.

## Historical 2026-10-10 PR173 publisher preparation; superseded by technical follow-up

The independent worktree based on published head `3dc896ade535cd2c51d30ffe7fe829b9b8cd03c8` now contains a default dry-run transport, exact multipart preparation, original-identity journal/reconciliation, raw-response readback validation and a fail-closed serial publisher. The coordinator consumes the [exact approved risk record](evidence/riffoid-risk-authorization-20261010.json). Unknown outcomes halt the original page's Run and cleanup; natural expiry skips are persisted before later restoration. This task grants no production writes.

[Preparation evidence](evidence/riffoid-release-preparation-20261010/summary.json) records 61 final offline fixture passes, 45 related Node passes, 15 authorized localhost Workerd passes and a successful typecheck. It retains the accidental sandbox EPERM failure. [Independent review](evidence/riffoid-release-preparation-20261010/independent-review.json) passed 14 new tests and found no remaining P1/P2 in the offline scope. Gateway's frozen candidate matches all 1,087 source/dependency inputs using existing read-only dependencies; no install was needed. Candidate and matching restoration module bytes exist, with eight complete metadata templates that retain null run/time/IP inputs and are explicitly non-executable.

The live path is incomplete: Gateway asset/five-container association coverage and resource snapshots, an existing authorized raw HTTP Response channel, and independent account/zone pipeline reads/validation are still missing. `pipelineGuardPassed:false` blocks every PUT until that adapter is implemented; changing a flag is not acceptable evidence. One immutable-version variable projection differs from full settings; truncation versus drift remains unknown. The full baseline is not certified. No new window, browser standby, deployment, paid execution, merge or Project status update occurred. The local changes have not been pushed. GitHub CI's empty-step failure remains unknown.

## Historical published integration snapshot — 2026-10-10; no deployment

The draft [PR173](https://github.com/jihegao/riffology-cloud/pull/173) receives the frozen v2 + v3-p2 repair on its current head. Marker-before-begin, fixed 300-second single-round bounds and original A-page cleanup are covered by local fixtures. The serial publisher/readback adapter has no live transport. Original unknown-write identities retain their version/content and deployment/version ledger checks without retry or cursor advance. Terminal evidence is limited to the two Observe, two Run and one cleanup application operations; no platform drain is claimed.

[Fresh integrated-code validation and retained failure evidence](evidence/riffoid-offline-integration-20261010/summary.json) records actual commands/results and source hashes. The prior failed fixtures and superseded internal review are retained. The parent reported independent rechecks accepted the frozen archives; that report does not replace current deployment or user acceptance. At that snapshot the two risk decisions were recorded pending. The later exact user confirmation is consumed in the preparation above; productionAuthorized remains false. No deployment, authenticated native-IP acceptance, platform test or paid execution is performed. Project reading remains unavailable; no status is invented or changed.

## 2026-10-10 #173 domain cutover preflight refreshed; real acceptance pending

[PR #173](https://github.com/jihegao/riffology-cloud/pull/173) remains a draft.
The new `app.riffoid.com` domain has valid HTTPS and returns
`503/two_account_auth_disabled`; the old application's curl homepage returns 200
with the existing strict CSP and `no-store`. No cutover T or 48-hour recovery
deadline has started. Python-client 403 responses are recorded separately and do
not replace the curl control or establish Browser Execution frame acceptance.

Fresh two-account readback matches the frozen safety-stage Gateway
`6edef49b-ca5c-4c97-bcec-5c141b079bb1`, entry
`c110d7a7-fc81-4bb1-b27a-4ca8147a7fff` and Execution
`c94df077-02a1-460f-8158-e47a338e68af`, with 95/5/4 bindings.
Each settings binding list exactly matches its immutable version's list; full
settings/resource and every binding digest were frozen locally. All three exact
`content/v2` module hashes match the previous evidence. Both WAF Block expressions
remain enabled; account/zone Logpush, observability destinations and relevant live
Tail lists were empty at readback. Persisted logs remain enabled. These observations
do not prove future capture absence or zero background work.

The existing maintenance/signature/entry/topology/forward-restore selection passed
45 Node/Workerd tests, including actual fixture replay and real 30-second expiry;
typecheck passed. Local maintenance bundles and non-executable metadata requests
were generated for review, preserving all 23 Gateway SQLite exports. No runtime
source was edited, candidate was uploaded, credential was read or platform execution
test was run. Global activity and infrastructure cost are not claimed zero.

Two actual visitor exits, an available original Google/browser identity, a quiet
publisher window, current semantically read-only in-flight observation, complete
rollback payload and temporary logging-change acceptance remain prerequisites.
The Mac was locked, preventing use of its existing authenticated browser. Delivery
Project could not be read: the existing CLI token lacks `read:project`, and the
browser attempt timed out; no scope was expanded or Project phase invented.
[Current evidence](evidence/riffoid-cutover-preflight-20261010.json) records the
fresh versions/hashes, checks, candidate identities and concrete remaining gaps.


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


## 2026-10-07 user-authorized trial validity extension through December 31

The current Private Beta review deadline is **2026-12-31 23:59:59.999
Asia/Shanghai** (`2026-12-31T15:59:59.999Z`). Existing invited accounts and
personal projects, including enabled Invited Runs, inherit this deadline.
Gateway `76380e93-a2ab-4cd8-9340-e3587d3956f6` is deployed at 100%, deployment
`b0d46e8a-77bb-42cf-93d6-0d36d756b537`. Of 93 bindings, only the original
v2 meter-only policy's `reviewAt` changed. Downloaded Gateway entry bytes,
all namespace identities, runtime/assets settings and all 15 container
application identities, versions, images and limits match the original release.

The existing protected `extendReview` RPC ran once on
`private-beta-capacity-v1`, with the exact old pin, zero occupancy/unresolved
execution and active operator verification. Independent readback confirms
configured/persisted pin `695cdd9ece91081e201a3dd03ba2ad7451931a0b588addc6454a1f6db9638031`,
Open capacity and active/quarantined 0/0. All 33 original slots, 129 observed
calls, four historical alerts, usage and 1,979,072,050-nanodollar conservative
reservation remain unchanged; one extension audit takes operations from 16 to 17.
Invited Runs remain ready, enabled, unpaused and occupied/unknown 0/0; their six
original dispatched/released leases and records remain exact. G5/M3/legacy M4
remain closed. Concurrency, timeouts, kill switch and fee history are preserved.

[Redacted release evidence](evidence/releases/beta-review-extension-20261007.json)
records explicit user authorization, deployment, original actor checksums,
request trace, authoritative execution counters and independent readbacks.
The temporary capability-protected maintenance Worker was removed and its absence
was verified. The recorded evidence does not establish deletion or revocation of
the task credential/capability; that cleanup remains unverified. The existing Workerd/SQLite extension regression
and exact deployed v2 policy parser/digest checks passed. No new user
Turn/provider/tool/experiment execution or ordinary-user acceptance was performed;
metadata/deployment cloud costs are not represented as zero. #104 stays
**Acceptance/open** for standing-operation exit criteria; the extension does
not settle #101 or replace remaining acceptance. Earlier dates below are
historical release snapshots.

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

## 2026-10-10 12:22 UTC continuation: baselines retained, writer pending

This dated follow-up supersedes the earlier locked-Mac/original-login/two-exit gaps. Original-account Safari login and two distinct desktop/mobile visitor exits were confirmed. Raw visitor IPs stay in an ignored private file. The original application authenticated as the existing Google identity; comparison at the new origin remains pending.

Exact complete rollback modules for Gateway `6edef49b`, Entry `c110d7a7` and Execution `c94df077` are retained privately with API-matching lengths/SHA-256. Fresh complete settings and 95/5/4 bindings match the previous freeze. Actual Gateway version JSON exposes all 23 SQLite exports, five current container associations and asset routing configuration; retention must keep that observed configuration. Eight scoped pipeline/tail inventories returned empty and both relevant WAF blocks enabled. Fifteen unfiltered container reads returned eight inactive instances, with no other states in those records; this is not a global activity/drain assertion. The dashboard code editor automatically issued two GET `/` previews returning `503/assets_not_configured` and connected its console; it was closed, and subsequent relevant tail lists were empty. No production configuration, capacity, instance, model/tool/Turn/Run write was submitted.

Relevant source and required fixtures from PR head `6ed830a17f2321de27446758074aff47550c99ea` were verified in an isolated directory. Seven offline suites passed **127/127**, typecheck passed, and latest Entry/Gateway bundles plus eight **non-executable** publication/restoration templates were prepared. Two initial omitted-dependency failures are retained; the final complete run passed. This is relevant-source verification, not a full checkout/tree certification or production acceptance. The old `04f00d6` candidate is marked superseded and must not deploy. No run/window/native marker was armed.

Current blocker: the existing MCP proxy may replay PUT and the reviewed non-dry-run adapter rejects writes before dispatch. The original local Wrangler OAuth expired on 2026-10-09; existing credentials do not supply a usable non-replaying writer for both accounts. Supplemental authorization for two native OAuth logins is pending; no grant or credential-value export was initiated. Previously approved application-terminal/late-telemetry log handling remains accepted; no absolute platform drain prerequisite is added. A native writer still needs independently checked all-layer non-replay, fresh complete raw readback, quiet-publisher/resource guards and actual A/B browser receipts before publication. New origin last observed `503/two_account_auth_disabled`; `T` and `recoveryUntil` remain null. Formal authentication/Execution/48-hour recovery acceptance is still separate.

Evidence: [browser and control-plane follow-up](evidence/riffoid-browser-followup-20261010.json). PR remains draft/unmerged; no Issue closure or Done transition.


## 2026-10-10 本机授权与完整发布读回

原、新账号的最小权限 Wrangler 本机 OAuth 均已完成，凭据仅保存在权限 0600 的本机命名配置。独立 Node HTTPS 通道使用一次新 HTTP/1.1/TLS 连接，不自动重试、跳转、代理或 fallback；PUT 保持 15 秒，GET 可明确采用 30 秒且完整读回仍限 120 秒。生产写入还必须绑定原始 durable intent、账号、body hash、阶段和批准窗口。原 MCP PUT 继续禁用；缺少的日志/容器元数据使用现有连接器只读获取。

7 组 preservation 检查 **135/135**、本机 HTTP 故障检查 **20/20** 通过。真实 Gateway/Entry 完整源码及全部资源读回均通过前后部署/latest/settings 括号校验，版本仍为 `6edef49b` / `c110d7a7`。原始 API 的 `use_containers`、实际资产路由字段及 nullable Tail 表示已纳入校验；Gateway 接受已批准的 keep_assets 保留合同，完整资产字节/集合审计仍未执行。无 DO 绑定、runtime/container exports 关联的 Entry 可确认没有本 Worker 的容器关联；这不宣称账号全局没有容器活动。

[本轮证据](evidence/riffoid-native-publisher-20261010.json)记录实际读回、测试范围及限制。先前字段差异和超时保留为失败证据。此快照没有生产 PUT、维护窗口、模型/tool/Turn/Run、正式切换或 T/recoveryUntil；双出口原始浏览器回执、排他协调和正式认证验收仍待完成。PR 保持 draft/unmerged，CI 不伪称通过，未关闭 Issue 或设置 Done。


## 2026-10-10 14:56 UTC — original Gateway write held for recovery approval

One native Gateway Observe PUT was acknowledged at version `a5ddd8f0-628b-4c90-8fa4-10177ffee906` / deployment `855e041d-5daa-42c4-b582-6a80b70fd3ed`. Its first readback rejected Cloudflare's changed binding array order, so the original intent remains unknown and its lock remains retained. Full subsequent GET-only readback passed after aligning bindings by their unique names: all 98 binding values, source modules, 23 exports, five container configurations and the observed asset retention contract match. Entry remains at `c110d7a7`; Execution received no write. Gateway log persistence is off; Entry logs remain at baseline. No A/B Observe, Run or cleanup operation was initiated, and this interrupted round is not an acceptance pass.

The comparer now accepts only binding order changes and still rejects duplicate/missing/extra names and value/resource drift. A separate recovery adapter requires a new exact approval for two original Gateway restoration writes, keeps the original unknown and lock, and cannot resume the validation protocol. The exact offline recovery package passed zero-network/zero-write checks; 49 related checks passed. Recovery is **prepared, not executed**, pending the user's additional approval under the existing unknown-log agreement. Late telemetry risk and platform drain remain unproven. Formal cutover, new-domain authenticated acceptance, T and recoveryUntil remain pending/null. [Evidence](evidence/riffoid-original-write-recovery-pending-20261010.json).
