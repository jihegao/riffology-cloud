# 需求、追溯与版本化模型产物合同

<a id="retirement-20261018"></a>

## 2026-10-18 撤销旧交付，已提交实现标为可清理

用户决定本轮候选包专用设计产物与 Model / Preview / Runs 子标签方案让位于 **agent plugin 和行业扩展包**。本次范围是 [PR #198](https://github.com/jihegao/riffology-cloud/pull/198) / [#182](https://github.com/jihegao/riffology-cloud/issues/182)（[JHG-22](https://linear.app/jhgao/issue/JHG-22)），以及直接延伸的 [SysML #180](https://github.com/jihegao/riffology-cloud/issues/180)、[领域视图 #184](https://github.com/jihegao/riffology-cloud/issues/184)、[领域恢复 #185](https://github.com/jihegao/riffology-cloud/issues/185)（JHG-20/24/25）。这些旧交付的未完成开发与独立验收撤销；已提交部分标为**可清理**，不再扩展平台专用 role/renderer 枚举、固定三页子标签或沿此合同补齐完整 SysML/观测/恢复矩阵。撤销不表示验收通过，也不撤销已合并、已部署的历史事实。

后续插件机制沿 [#213 / JHG-50](https://github.com/jihegao/riffology-cloud/issues/213)，行业内容按新的扩展包范围重新定义；项目技能、通用页面和公共资源能力分别沿 [#85](https://github.com/jihegao/riffology-cloud/issues/85)、[#214 / JHG-46](https://github.com/jihegao/riffology-cloud/issues/214)、[#215](https://github.com/jihegao/riffology-cloud/issues/215)。这些关联不表示新插件或行业扩展包已交付。需求/追溯/计算及 compiler 的独立事项不随本次四项撤销；旧 #198 验收也不再作为通用页面或新插件的前置。

### 仓库改动与清理边界

审计基线为 main `638a366d31a37f7bc1d7dcd124e0b5ba753d6401`。#198 合并 `582ed338cdf404089328f6d6e0d0ddd6edbd7701`、审阅 head `779c8488a5f9f70840224b8b3cbff2b2522ffc45`，相对第一父提交共改动 **39 个文件**。逐文件归类、合并时与审计时 blob 身份及共享消费者见[清理清单](evidence/releases/candidate-v3-retirement-inventory-20261018.json)。以下“可清理”是后续删除/迁移的候选范围；本次只改记录和文档。

| 已提交部分 | 标记与实际依赖 |
| --- | --- |
| `services/simulation/model-artifacts.ts` 的 `model/artifacts.json`、document/sysml/graph 与专用 renderer 合同 | 可清理；先解除候选读写、模型检查和旧 Preview 消费，核对仍需读取的已保存版本。专用角色与图渲染转由行业扩展包定义，不再扩充宿主枚举。 |
| `services/web/artifact-views.js` 的 `artifactView`、`simulation.js` / `browser-preview.js` 的旧设计/子视图接线，以及对应 CSS、翻译和静态路由 | 可清理专用部分。`createViewTabs` 当前还控制通用项目页的激活与隐藏；须先迁移其生命周期、键盘/焦点与选择恢复，再移除旧壳。不能整文件删除共享代码。 |
| `services/turn-runtime/managed-candidate-v3.ts` 的 design/model 专用分支、旧指令、恢复与模型/Preview 适配 | 可清理专用部分；同文件后续已加入 `operation=pages` 和项目文本资源支持，不能回退整个 v3 resolver。存储、展示、运行资格仍分别判断。 |
| `workspace-file-index.ts` 的 `overlayWorkspaceArchive` | 保留共享能力；当前被通用 pages 与 `manual-save.ts` 调用，继续保留原文件、二进制、权限位与目录，并校验安全路径。 |
| `turn/{protocol,store,journal,dispatcher}.ts`、`managed-product.ts` 及 `app.js` 的 answer/unchanged 处理 | 保留共享能力与持久数据兼容。`persistenceOutcome=unchanged` 已进入 reader/终态约束；仅回答不制造 Revision 是仍可复用的行为。移除旧候选格式不能破坏历史记录、base/CAS、原请求终态和资源释放判定。 |
| `simulation/source.ts` 的完整文件摘要检查、`research-context.ts` 的内容预算与证据边界 | 保留通用保护；设计 payload 专用字段可随其消费者迁移清理，不放松摘要校验或让设计文本挤掉 Run/Evidence 记录。 |
| #198 中的测试、package/i18n 脚本登记与两份文档 | 专用用例/脚本登记随实现清理；共享保存、终态、身份、无重放、焦点/释放等回归继续保留。历史合同、提交和发布收据留作证据。 |

不能整体 revert #198：后续通用页面、手工保存与终态恢复已经复用其中代码。实际清理应先在当前 main 分离专用和共享调用，再以相关回归验证迁移；无引用和持久数据兼容证据不足时保留 reader。数据、账本、模型/Session/Revision 及历史发布证据的删除不包含在本次标记内。

### 历史事实与验证范围

#198 已于 2026-10-14 合并，并随 main `eba528f7` 部署，见 [#182 部署回填](https://github.com/jihegao/riffology-cloud/issues/182#issuecomment-6164913633)和[发布记录](main-integration-release-20261014.md)。当时真实普通受邀身份的 design/answer/子标签验收仍 pending；本次将该旧方案的未完验收撤销，不能把历史 pending 改成通过。JHG-56 保留通用页面的保存、版本身份、无重放和隔离验收，移除对旧 design/固定三页的专门验收要求。

本次仅核对 Issue/Linear、合并差异、当前源码调用与文档链接，并运行 JSON/清单完整性和 `git diff --check`。未删除实现、部署或运行模型/Turn/Run；未重新确认当前生产版本。原 CI 额度豁免及其他历史检查仍只属于原版本。

---

## 以下为历史设计与实现快照

日期：2026-10-12。负责人：@jihegao。对应 [#179](https://github.com/jihegao/riffology-cloud/issues/179) 完成条件第 6 项的第一阶段设计，评审载体为 [PR #189](https://github.com/jihegao/riffology-cloud/pull/189)，父项 [#177](https://github.com/jihegao/riffology-cloud/issues/177)。第 0 节记录 #182 的最小实现契约；第 1–8 节保留 2026-10-12 的完整能力提案，尚未完整实现、部署或验收。设计评审通过不能关闭需求功能 Issue。范围、依赖和交付阶段以 Issue / [Delivery Project](https://github.com/users/jihegao/projects/1) 为准，本文不另建任务状态表。

源码基线：Cloud `25609953f5c3b69dcb44e520d7e7ed1253d18fe4`；compiler GitHub main `ee6a2aa7a66d8bf2609059aaf8a7c0fe22fe8683`。2026-10-12 复核两个 GitHub main 仍是这些 SHA；本地 clone 的 origin 指向本地仓库，不作为远端状态证据。最初本地 compiler `a1a44c7` 落后远端；补读了远端 bounded profile、IR/layout/runtime、ABM 版本及 Rust result/request 类型。第 1–8 节的新 schema、类型、函数、路径是该日提议；当前已接线子集见第 0 节，未部署。未全面复审这八个远端提交，也未重新执行它们的测试。

<a id="candidate-v3"></a>

## 0. 2026-10-14 最小实现契约（#182，核心实现；未部署）

本次源码以 Cloud main `957b579fbb9f8cb79a9092605d50094ee6a64dbb` 为基线，实现范围来自 [#182](https://github.com/jihegao/riffology-cloud/issues/182) / Linear JHG-22；接口关联 #180、#184、#185。原用户项目没有可读的 Turn/candidate 诊断证据，不能据此断言其原始失败原因，也未重放该请求。

### 应放开的约束

| 原约束 | 本次实现 | 继续保留的边界 |
| --- | --- | --- |
| 解释问题也强制完整模型和默认运行 trace | `candidate.schemaVersion=3, operation=answer`，完成 Turn 而不创建 Revision | 必须收到原 remote Turn 的 completed 证明；scope、dispatch、base、资源释放与计量仍校验 |
| 保存产物必须先具备可执行模型 | `operation=design` 只更新设计内容；缺少 ModelSpec 的 Revision 可展示但 canRun=false | 不填造 Spec、结果或 trace；不触发 Preview/Server Run |
| Managed 文件只能是计算/前端固定角色 | 增加受控 UTF-8 document、sysml、graph 角色，全部进入同一 archive | 不接受 HTML/可执行设计文件、URL、任意 role、任意路径或依赖安装 |
| Model/Preview/Runs 只有整体页面 | manifest 声明一层子标签；平台负责导航和渲染器 | 不递归嵌套，不运行模型生成的宿主页面代码；标签切换不增加执行请求 |

`operation=model` 仍调用原 candidate v2 校验器校验完整 Spec、源文件、默认输入、报告 trace 和结果一致性。candidate v1/v2 的原字段、文件和验证语义保持不变。Browser Preview v1/v2 仍分别接受原五/七个计算文件；设计视图从同一冻结 Revision 单独读取，通过完整 archive `filesSha256` 与已加载 package 核对，不向旧包追加字段或文件。

### candidate v3

```json
{"schemaVersion":3,"operation":"answer"}
```

answer 不接受其他字段；持久化终态为 `persistenceOutcome=unchanged`，checkpoint=null，workspace/session head 均保留。会话接续记录保存最新 Turn 身份，避免把“没有新 Revision”误判成无法继续。重启只观察原请求；资源释放 pending 时仍保持容量 hold。

```json
{
  "schemaVersion": 3,
  "operation": "design",
  "artifacts": {
    "schema": "riffology.model-artifacts/v1",
    "files": [{"path":"design/port.sysml","role":"sysml"}],
    "views": [
      {"id":"sysml","section":"model","title":"SysML","renderer":"source","source":"design/port.sysml"},
      {"id":"scene","section":"preview","title":"运行场景","renderer":"scene","source":"preview.trace"},
      {"id":"metrics","section":"preview","title":"指标","renderer":"metrics","source":"preview.trace"},
      {"id":"history","section":"runs","title":"运行记录","renderer":"history","source":"runs.records"}
    ]
  },
  "files": {"design/port.sysml":"part def Crane;"}
}
```

平台保存 `artifacts` 到 `model/artifacts.json`。这是结果版本的**完整展示清单**，`files` 是声明文件的增量内容；未提供的声明文件必须已存在于本次授权 base。未提及的原文件（含二进制输入、计算与前端）保留，不做隐式删除。model 操作还需要 `spec`、`preview` 与原 v2 的四/六个计算文件；继承设计清单时不用重复提交其内容。

当前 v1 manifest 只包含 schema/files/views，不接受后续 v2 提案中的 compute/requirements/backendRequirements 等字段。角色与展示如下：

| role / renderer | 路径与显示 |
| --- | --- |
| document / document | `design/**/*.md` 或 `.txt`，按文本显示，不执行 Markdown 内嵌 HTML |
| sysml / source | `design/**/*.sysml` 或 `.txt`，源码显示 |
| graph / graph | `design/**/*.json`，平台 SVG 节点/连线视图 |
| Preview scene / metrics | source 固定 `preview.trace`，共用当前 runtime、trace、参数和播放器 |
| Runs history / metrics | source 固定 `runs.records`，展示平台记录的单次实验和浏览器本地结果；保留每条历史 Revision/seed/参数/状态，不采用候选包自报的指标 |

图文件格式为 `{"schema":"riffology.design-graph/v1","kind":"bdd|ibd|activity|parametric|general","nodes":[{"id":"Crane","label":"Crane"}],"edges":[]}`（kind 取枚举中的一个值）。允许 64 个唯一节点、128 条边、128 字符标签，边端点必须存在。图是作者声明的设计关系，不是 SysML 解析结果；界面明确标明未做 SysML 语义核验。本次没有实现完整四种 SysML 图的符号/语义编辑器或自动追溯验证。

所有 views 使用唯一稳定 id、section、title、renderer、source，未知字段/渲染器/错误来源拒绝保存。最多 24 个设计文件、24 个视图，manifest 32 KiB、每个设计文件 128 KiB、保存的设计内容合计 512 KiB、candidate JSON 512 KiB；完整归档最多 8 MiB/512 文件，设计内容读取上限仍为每文件 128 KiB；其他原文件、权限位和空目录按原归档保留，不执行或重新解释。路径只允许 design 下 ASCII 字母/数字/下划线/连字符组件；拒绝 traversal、绝对路径、链接和远程资源。图文进入受控 DOM/SVG，不加载作者代码。

子标签选择按 tenant/workspace/section 与完整文件摘要（Preview 使用 packageIdentity）绑定，刷新/离开后恢复；视图删除、版本或身份改变时回到概览。Runs 的历史记录继续绑定自己的版本，显示视图不会改写记录。该状态不包含新的执行意图。旧项目没有 manifest 时保持原页面内容。

实现入口：[v3 candidate](../services/turn-runtime/managed-candidate-v3.ts)、[角色与视图校验](../services/simulation/model-artifacts.ts)、[Turn 终态](../services/turn/journal.ts)、[平台子标签/图文](../services/web/artifact-views.js)。验证入口：[candidate 回归](../tests/m2/managed-candidate-v3.test.ts)、[Managed Workerd](../tests/m2/managed-product.test.ts)、[终态与释放](../tests/m2/managed-dispatcher.test.ts)、[Model/Runs 浏览器](../tests/m3/artifact-views.test.mjs)、[Preview 浏览器](../tests/m3/browser-preview-panel.test.mjs)。合并、发布及真实身份验收以 Issue/PR 和发布索引后续证据为准。新终态 `unchanged` 写入后，回退到不认识该终态的旧 Journal reader 会拒绝读取；发布/回退必须保留这个兼容 reader。

## 1. 扩展点与现有边界

| 已核对入口 | 实际能力与扩展位置 |
| --- | --- |
| [Turn 协议](../services/turn/protocol.ts)、[Revision](../services/turn-runtime/revision.ts)、[RevisionStore](../services/turn-runtime/revision-store.ts) | CheckpointReceipt 已绑定 Revision、完整 archive 与 Session 摘要；create-only R2 对象读回核对，TurnJournal 保留 head 提交权威。新模型产物进入同一次冻结文件快照，不引入第二个可变模型 head。 |
| [candidate artifact](../services/turn-runtime/candidate-artifact.ts) | archive 已校验文件清单、长度与摘要；packageCandidateModel 可包装 Python/compiler Spec，但不等于需求、前端或 trace 已完整校验。 |
| [Managed 基线](../services/turn-runtime/managed-product.ts)、[基线生成指令](../services/turn-runtime/managed-testing-instructions.ts) | 在上述 `25609953` 快照，交互候选限定三个 UTF-8 文件，恢复仅取 Python/Spec/lock；指令写死 road，包阶段强制 lane。这是旧基线缺陷，不用于否认关联修复 PR 的能力。 |
| [Model Spec](../services/simulation/model-spec.ts) | v1 接受标量参数和有限数值指标；compiler-v01 要求空 runtime parameters。旧 entities/mechanisms/assumptions 字符串数组不提供稳定需求或元素身份。 |
| [Preview contract](../services/browser-preview/contract.ts)、[profiles](../services/browser-preview/profiles.ts)、[视觉协议](../services/browser-preview/runtime/protocol.mjs) | browser-preview/v1 固定五路径，v2 再加固定 frontend manifest/main 两路径；两种 Python profile，grid/lane 输出。多模块、结构化输入、IR/WASM 不属于这些旧合同。 |
| [compiler authoring](compiler-v01-authoring.md)、[bundle inspector](../services/simulation/compiler-bundle.ts) | 同版保存 Business IR、simpack、Spec；Cloud 固定 aircraft v0.1 合同；Browser Preview 未支持 compiler bundle。 |
| [release-readiness](release-readiness.md) | 浏览器本地 Runs 已记录一个认证 owner 的验收；其他身份/计数/云端失败覆盖分开记录。本文不改变部署或验收结论。 |

关联 [PR #190](https://github.com/jihegao/riffology-cloud/pull/190) 的审计 head 为 `b41678889f8152c78783512ed5d47bd64928c602`，复核时为 open/draft、未合并。其 [candidate reader](https://github.com/jihegao/riffology-cloud/blob/b41678889f8152c78783512ed5d47bd64928c602/services/turn-runtime/managed-candidate.ts) 已增加 candidate v2、grid/lane/Python canvas/JS canvas 选择、既有角色的保存/恢复、默认输入与报告 trace/摘要检查；legacy 继续编辑继承已保存 visualization/frontend。报告标 `execution:'not-recomputed'`，legacy trace 标 `not-provided`。它保留现有 Browser 五/七路径、两种 profile 和 Managed 六根包策略；任意 roles、完整依赖准入、目标 runtime 执行/debug 仍分别属于 [产物保存项 #182](https://github.com/jihegao/riffology-cloud/issues/182) 与 [后端执行项 #183](https://github.com/jihegao/riffology-cloud/issues/183)。本设计不以 PR 的静态/单测结果宣称已部署或完整用户验收；合并后这些源码能力以该提交为准，仍不等于本文新 manifest 已接线。

Compiler 保持 Business → symbolic Core → layout → ExecutionPlan；可变 RunState 在 Plan 外。Business ID/Core symbol 是稳定身份，Plan 数组下标只是该版定位。领域规则放 domain lowering；runtime 不按案例名分派。现有 aircraft minute operations 是受限兼容操作，不是跨领域通用指令集。

可复用的 [lineage/impact](https://github.com/jihegao/sim_engine_compiler/blob/ee6a2aa7a66d8bf2609059aaf8a7c0fe22fe8683/docs/three-layer-ir.md) 提供静态关联；[review-data/v1](https://github.com/jihegao/sim_engine_compiler/blob/ee6a2aa7a66d8bf2609059aaf8a7c0fe22fe8683/docs/review-data-v1.md) 是部分投影，不含 SysML parser/UI，拒绝 ABM。[trace-query/v1](https://github.com/jihegao/sim_engine_compiler/blob/ee6a2aa7a66d8bf2609059aaf8a7c0fe22fe8683/docs/trace-query-v1.md) 只支持现有 Python reference、aircraft、unindexed、legacy-minute-v1 的已记录 Full 事实；Rust/O5、guard/causal 和可信消费证明未交付。source_path 相同只证明设计关联，不证明因果。新 bounded profile 的 trace 不能直接传给旧 query 并声称支持。

远端 [aircraft-bounded-events/v1](https://github.com/jihegao/sim_engine_compiler/blob/ee6a2aa7a66d8bf2609059aaf8a7c0fe22fe8683/docs/aircraft-bounded-events.md) 已有 opt-in Python-only 三层 IR、20 条有限 aircraft chains、微秒事件排序、原子 resource lease、物品守恒、时间/事件预算和独立组合测试。应审计复用它的最小语义，不能重新排成从零开发。它仍是 restricted aircraft domain profile，既有 Rust/public v0.1 bundle/Cloud 未采用；不声称通用 DES、机场地面运动或原生随机等价。EventCalendar/CapacityLedger 可复用与否须按具体 Queue/机场操作合同核对；本次没有证明跨领域泛化。

## 2. 稳定需求与来源

提议 `requirements/requirements.json`，schema `riffology.requirements/v1`。所有对象严格拒绝未知字段/版本、重复 JSON key 与非有限数字。

```ts
type RequirementRef = { id: string; version: number };
type RequirementKind = 'research-question' | 'functional' | 'performance'
  | 'constraint' | 'assumption' | 'acceptance';
type SourceLocator =
  | { kind: 'user-turn'; sessionId: string; turnId: string }
  | { kind: 'assistant-event'; sessionId: string; turnId: string;
      eventId: string; sequence: number; pointer: string }
  | { kind: 'saved-file'; revisionId: string; filesSha256: string;
      path: string; sha256: string; pointer: string | null }
  | { kind: 'user-action'; actionId: string; pointer: string };
type RequirementSource = {
  id: string; locator: SourceLocator; contentSha256: string;
  span: { startByte: number; endByte: number } | null;
  excerpt: string;
  resolutionAtCapture: 'resolved' | 'unavailable' | 'caller-asserted';
};
type RequirementVersion = {
  version: number; kind: RequirementKind; title: string; statement: string;
  disposition: 'proposed' | 'confirmed' | 'retired';
  sourceIds: string[]; parentRequirementId: string | null;
  subjectElementId: string | null; acceptanceRefs: RequirementRef[];
  quantitative: null | {
    metricKey: string | null; unit: string | null;
    comparison: 'lt' | 'lte' | 'eq' | 'gte' | 'gt' | null;
    threshold: number | null;
    aggregation: 'instant' | 'mean' | 'maximum' | 'minimum' | 'sum' | null;
    scenarioInputId: string | null;
  };
  change: {
    kind: 'create' | 'edit' | 'confirm' | 'retire' | 'reopen';
    actorKind: 'user' | 'agent' | 'import'; sourceId: string;
    confirmationActionId: string | null;
  };
};
type RequirementsArtifact = {
  schema: 'riffology.requirements/v1'; namespaceId: string;
  sources: RequirementSource[];
  groups: { id: string; label: string; parentGroupId: string | null;
    requirementIds: string[] }[];
  requirements: { id: string; introducedBy: 'user' | 'agent' | 'import';
    agentSupplement: boolean; currentVersion: number;
    versions: RequirementVersion[] }[];
  derivations: { id: string; original: RequirementRef;
    derived: RequirementRef[]; sourceId: string }[];
};
```

namespaceId 由项目服务分配并持久保存；后续 Revision 沿用。需求/分组/关系/source 使用带类型前缀 UUID，例如 rq_<uuid>；不由标题、文本 hash、数组、父节点或代码行号生成。编辑/重排保留 ID；拆分/合并/新增分配新 ID，保留旧记录和派生依据。引用完整键是 namespace + ID。跨项目复制分配新 namespace 并保存原 namespace 来源，不能仅凭相同 UUID 连接两个项目。

version 从 1 连续增加；已有 versions 前缀必须与原保存文档的规范投影逐项相同；currentVersion 指向末项。编辑、确认、撤回追加版本，不能覆盖或删除历史。每个版本的 sourceIds 非空、去重且包含 change.sourceId，所有引用须存在；每条派生的 sourceId 同样必需。introducedBy/agentSupplement 和 source 记录创建后不可覆盖或删除，sources 仅追加新 ID；重排数组只比较 ID 对应内容，不产生新身份。对已确认正文的修改先变回 proposed；确认是追加的独立动作，不沿用旧确认。retire 生成 retired，reopen 回到 proposed；retired 不因 Agent 改写而自动恢复。Agent 假设确认后保留 agentSupplement 与最初来源，不改成用户原话。

confirm/retire/reopen 只改变 disposition、动作来源和 version/change；kind/title/statement/subject/quantitative/验收引用等内容必须与前版相同，改写须走 edit。confirm 的前态为 proposed，reopen 的前态为 retired，retired 的直接 edit 拒绝；已确认版本重复确认不追加伪历史。导航分组变化不产生需求正文版本，但保存新 Revision 并保留旧导航快照。

用户来源用实际 TurnRecord.message，不虚构目前不存在的 user message ID；助手来源用实际 TurnEvent ID/sequence，pointer 指向该已持久事件内的文本字段。多个 delta 分别引用，不将拼接后的 UI 文本冒充一个不存在的事件。user-action pointer 指向服务端留存 action 正文中的文本；saved-file 固定已提交来源 Revision/完整 archive/文件摘要，pointer 只提供字段定位，不引用尚未生成的当前 Revision。原文 target 是对应的消息文本、事件/action 文本字段或文件原始 UTF-8 字节；contentSha256 绑定整个 target。span 是其 UTF-8 字节半开区间并落在字符边界，excerpt 必须等于该片段；JSON 文件引文显示原始转义，不先归一化 Unicode/空白再声称原话。span=null 只用于无可复核引文的来源，不能显示为已核实原话。

只保存有界摘录；完整来源经授权读取，不打包聊天、Session 或凭据。resolutionAtCapture 是创建 source 时的冻结事实；reader 的当前 resolution 另行派生，不能因 TurnEvent 保留窗口过期而重写旧 source。历史来源不可用时显示 unavailable，保留当时摘录和摘要，不伪造补全。Agent 补充内容可引用所依据的用户请求，但必须保留补充标记；该请求并不因此成为新假设的用户原话。

确认不能只相信 candidate JSON 的 actorKind。Agent 新建/改写只能 proposed；保留原 confirmed 记录须匹配旧快照。confirm/retire/reopen 必须由授权用户 action 持久收据证明，绑定 actor/project/base Revision/requirement ID/version/修改摘要。提交服务验证收据后生成文件快照；Agent 自造 actionId 拒绝。来源解析和 confirmation receipt port 尚未实现，不称为当前 TurnJournal 已有 API。

提议可信收据类型（scope/actor 复用 TurnScope/TurnActor，不接受模型自行声明授权）：

```ts
type RequirementActionReceipt = {
  schema: 'riffology.requirement-action/v1'; actionId: string;
  scope: import('../services/turn/protocol.ts').TurnScope;
  actor: import('../services/turn/protocol.ts').TurnActor;
  baseRevisionId: string; baseRequirementsSha256: string | null;
  namespaceId: string; requirementId: string;
  fromVersion: number; toVersion: number;
  operation: 'create' | 'edit' | 'confirm' | 'retire' | 'reopen';
  changeSha256: string; recordedAt: number;
};
```

changeSha256 是 `{namespaceId,requirementId,fromVersion,toVersion,operation,nextContent}` 的规范 JSON 摘要；nextContent 为下一版本除 version/change 外的内容，不含 action 收据或最终 Revision hash，避免循环。toVersion=fromVersion+1，fromVersion 匹配 base 中 currentVersion；create 则要求 base 无该 ID、fromVersion=0/toVersion=1，首次添加需求文件时 baseRequirementsSha256=null。收据必须经授权服务查询，不能从 candidate 文件直接信任。相同 actionId/摘要的重复提交只查询原提交结果，异摘要冲突；head 已变化返回 conflict，不能自动套用旧确认。纯用户新建/改写通过 authoring-edit 收据证明来源并保持 proposed；confirmed 只由独立 confirm 动作产生。Agent 新建无需确认 action，但须有实际来源并保持 proposed。actorKind/introducedBy 是展示元数据，其 user/agent/import 来源由可信提交 context 核对，不能仅相信 candidate 自报。

纯用户编辑不能伪装成 provider Turn。提议作者保存 port `commitAuthoringEdit({scope,actor,baseRevision,actionId,changeSha256,filesArchive})`，返回原形态 CheckpointReceipt；在同一 RevisionStore/Workspace head CAS 中提交，保留旧 Session/backend 状态。现有 writer 的 saved-turn manifest/key/reader 不能直接承载此来源：接线 PR 必须增加显式 user-edit provenance、版本分派及授权/并发检查，保留 schema 3/4 原解释，禁止制造 TurnRuntimeIdentity 来绕过。这一手动保存扩展尚未实现；在它接入前，确认可作为待保存草稿，不能标为已冻结 Revision，也不能自动发起付费 Turn。

该 port 首个接线范围要求已保存的 baseRevision；没有 head 的纯手工初次保存仍为 unsupported，须另以已授权 InitialWorkspaceReference/摘要定义新 provenance 分支，不能为了获得 saved-turn key 自动创建 provider Turn。action 收据持久化先于提交；只在 head CAS/原提交结果确认后把 UI 标为已保存，pending 不重复生成动作或发起计算。actor 的当前授权在提交时再次核对，不因旧收据存在而跨撤权继续写入。

阈值、单位、聚合或 scenario 未确定时保留 null；不得补默认成功、把 null 当 0。确认状态、实现覆盖和验证结果独立。groups 仅用于导航；parentRequirementId 表示语义子需求，subject 绑定必须明确。派生与层级不互相推断；Riffology v1 额外限制两种图为 DAG，这属于本产品支持子集。

首版 validator 预算提议：文件 256 KiB；512 个需求、每项最多 32 个历史版本；128 sources，每段摘录 2 KiB；正文 8 KiB、标题 256 字节；512 条派生、每条 32 个目标；层级 16。512 是需求上限，128 是不同来源记录上限，并不保证 512 个不同来源的需求都可保存；多个需求/版本可以引用同一已核对 source，同一 locator/hash/span/excerpt 不重复占用 source 名额。每版必须有来源，不能为满足需求计数而省略引用。计数与整个文件字节同时受限，超过返回 path/limit/actual 诊断并保留旧版与草稿，不裁剪历史、不滚动覆盖旧版本。v1 没有历史分段/归档格式；第 33 版或第 129 个来源明确拒绝，后续扩容必须交付显式 schema/reader 迁移，不通过改 namespace 清空原历史。

## 3. SysML 2.0 展示子集

语义依据固定 [OMG SysML 2.0](https://www.omg.org/spec/SysML/2.0) 的 [Language formal/2026-03-02，March 2026](https://www.omg.org/spec/SysML/2.0/Language/PDF)。产品子集版本提议 `riffology.sysml-requirements/1`，不声明完整 SysML 合规。

| 产品对象 | 子集映射 | 边界 |
| --- | --- | --- |
| 分组、来源、确认状态 | package；产品状态/来源置 sidecar | 导航包含不产生满足语义。 |
| 需求 | requirement definition/usage、doc、稳定生成名称与 short name | §7.21 / §8.2.2.21；研究问题单独标注，不自动变成必须成立的 requirement。 |
| 子需求/subject | composite requirement usage、明确 subject 绑定 | 不猜未声明 subject，不把导航层级当语义组合。 |
| 可形式化假设/要求 | assume/require constraint | 仅支持已解析单位的单个标量比较；布尔组合尚无 JSON 表达式合同，未知文本保留 doc/unresolved，不能生成恒真表达式。 |
| 明确满足断言 | satisfy requirement usage | 是作者模型断言，普通 implements 边不自动升级为 satisfy 或通过。 |
| 验证计划 | verification definition/usage、objective 中 verify | §7.24 / §8.2.2.24；建立 case 不产生 verdict。 |
| 派生 | §9.6 Requirement Derivation Domain Library | 采用 originalRequirement → derivedRequirements 的库端点，不套 SysML v1 deriveReqt。 |

文本/图形投影依据 §8.2.2.21/24、§8.2.3.21/24；语义关系依据 §7.21、§7.24、§9.6。派生库固定 [OMG ptc/25-04-30 KPAR](https://www.omg.org/spec/SysML/20250201/Requirement-Derivation-Domain-Library.kpar)，本次只读下载 SHA-256 `a136e72ac6afbd96ede220cfec77fd54c75242d577d3f5ab9e5278b25baee6e5`。实现时还须固定 Systems/Kernel/所用 Quantities and Units 的字节摘要，不追随 latest。

生成文件为 requirements/requirements.sysml 与 requirements/sysml-map.json。JSON 是编辑权威，SysML 为确定性导出。后续文本编辑须通过受限 parser 转为需求修改并保存新 Revision；不能只改 text 而 JSON/map 沿用旧身份。首版不支持任意 SysML 导入、未知 imports/网络库、完整行为执行或任意单位代数。

map 合同：`{schema:'riffology.sysml-map/v1',subsetVersion,requirementsSha256,elementsSha256,traceabilitySha256,textSha256,libraryPins,checkerPin,mappings,omissions}`；未输入 registry/trace 时对应摘要为 null。每条 mapping 为 `{namespaceId,requirementId,requirementVersion,qualifiedName,startByte,endByte}`；omission 为元素/需求定位、reasonCode 和缺口。subject/satisfy/verify 所用 registry/trace 同样绑定摘要，不因需求正文未变而复用旧图。导出错误不能与旧 text/map 混用。源/confirmation/本地证据留 sidecar，不伪装标准 verdict。

可编码入口为 `exportRequirementsSysml({requirements,elements,traceability,pins}) -> {textBytes,map,diagnostics}`。有限 AST 只容纳 package、requirement definition/usage、subject、doc、assume/require 比较、satisfy、verification case/objective/verify 和 Derivation 端点，以及 subject/metric 所需的最小 part/attribute 声明骨架；辅助骨架是 registry 的静态投影，不宣称完整系统结构或行为。未知元素类型/单位不猜测。ID 转为固定 ASCII 名称（UUID 去连字符），label/statement 仅作为转义 doc；按稳定 ID 排序，每个当前 requirement version 只投影一次，历史由 JSON 留存。research-question 生成 doc 索引项并记录 omission，不生成必须成立的断言。quantitative 所有必需字段、被比较的 metric 元素与单位均已解析时才能生成比较；首版不把 mean/sum 等聚合自动翻译成时间序列算法，聚合仍作为验收方法的 sidecar 条件。null/未知单位/未声明 subject 生成 doc-only 与准确 omission，不输出恒真 require。多个比较/布尔组合首版未在 RequirementsArtifact 建模，明确 unsupported，后续必须增加版本化表达式合同；不能让 exporter 自行补出 AST。语义子需求仅对显式声明端点生成，导航组不隐式制造组合需求。

普通 implements 仅显示产品边；明确 satisfaction-assertion 才导出 satisfy，且 subject 与 satisfying feature 必须可解析。verification-case 的 target 必须是显式 test 元素，case 只表达验证意图，运行 verdict 在独立评价记录。派生引用 pinned requirement versions；若端点不是当前投影版本，记录 stale/omission，不能悄悄改到当前版本。这些生成规则是实现合同；具体文本模板及语法成功属于后续 [SysML 实现项 #180](https://github.com/jihegao/riffology-cloud/issues/180) 的 checker 验收，本 PR 不交付 exporter/parser。

两层校验：本仓库有限 AST/semantic validator（提议 riffology.sysml-subset-validator/1）检查 names/subject/端点/单位/sidecar；另用官方 [Pilot 2026-03，Eclipse plugin 0.58.0](https://github.com/Systems-Modeling/SysML-v2-Pilot-Implementation/releases/tag/2026-03) 离线检查文本兼容。[库发布基线](https://github.com/Systems-Modeling/SysML-v2-Release/releases/tag/2026-03) 为 commit cd99f7ca70b96abb38f09dfd25725e3cf259baa3。Pilot 含修复先行实现，不能取代 formal 语义。libraryPins 每项固定 `{name,version,sha256}`，checkerPin 固定 release/plugin/安装闭包摘要；checker 执行收据另绑定 textSha256 与 pins，map 自报 pass 无此权威。本次未安装/运行 checker；安装闭包、命令和生成语法的实际验证 pending，实施 PR 固定摘要后才可报告 checker 通过。

视图由同一 AST/map 生成，点选显示详情、来源、确认、派生、满足断言和验证计划；missing/unresolved/unsupported 可见。当前这些 exporter/parser/交互视图均未实现。完整 KerML/SysML 编辑/导入、执行、认证交换与自动证明不属于该子集。

## 4. 稳定模型元素、定位与追溯

提议 model/elements.json：`{schema:'riffology.elements/v1',namespaceId,elements:[{id,kind,label,basis,locators}]}`。kind 为 entity/resource/space/event/rule/constraint/parameter/metric/code/test；basis 为 author-declared 或 compiler-validated。Python 显式 registry 关联作者元素 ID 到符号/字段/代码段；定位存在不证明 Python 完整语义。重命名保持作者元素 ID，旧 registry 留在旧版。compiler 稳定 ID 原样保留为 layer/kind 限定的外部身份，不能散列一个 Plan index 冒充稳定 ID；registry 自己的 el_<uuid> 是产品引用键。

```ts
type ArtifactLocator = {
  path: string; sha256: string;
  location:
    | { kind: 'json'; pointer: string }
    | { kind: 'text'; startByte: number; endByte: number;
        language: 'python' | 'javascript' | 'sysml'; symbol: string | null }
    | { kind: 'bundle-member'; member: string; memberSha256: string;
        layer: 'business' | 'core' | 'plan'; fingerprint: string;
        elementKind: string; stableId: string | null; pointer: string };
};
type TraceEdge = {
  id: string; requirement: RequirementRef; elementId: string;
  relation: 'implements' | 'satisfaction-assertion' | 'verification-case';
  locator: ArtifactLocator;
  basis: 'author-declared' | 'validated-compiler-lineage'
    | 'validated-profile-source-map'; sourceId: string;
};
type TraceArtifact = {
  schema: 'riffology.traceability/v1'; namespaceId: string;
  requirementsSha256: string; elementsSha256: string; edges: TraceEdge[];
};
```

path 只在同一保存 archive 的已声明 roles 中解析，核对 hash/pointer/span，不接收文件系统绝对路径或 R2 key。Compiler 使用 layer/kind/stable symbol/fingerprint；simpack 通过已验证 loader 取 raw member，不把 review report 当 raw bundle。bundle-member 的 layer=business/core/plan 分别是 v0.1 的 business.json/core.json/plan.json 原始成员；plan 指 ExecutionPlan，layout 是 Core→Plan 转换过程，没有独立的第四 raw member。memberSha256 是 ZIP 解压后的原成员字节摘要，fingerprint 按对应版本 validator 的语义计算，pointer 指该成员原 JSON；二者都不可用 review/view_fingerprint 替代。Plan 数组 pointer 只定位本版，stableId=null 表示无本层稳定身份；回连 Core symbol 必须由同版 lineage/source-map 证明，不能从数组地址推导。lineage.json 是跨层校验依据，不能伪装成某一层模型元素。

跨层展开保持一对多、association_status、partial 和遗漏；同版 Business/Core/Plan/lineage 全部验证后才能标 validated-compiler-lineage。新 bounded/ABM 若尚无相同公共 lineage 合同，只能在该 profile 的原始产物 loader/validator 已注册后采用 validated-profile-source-map，绑定确切 profile/source-map/Plan 指纹；当前 Cloud v0.1 loader 不接受这些产物，不能先标该 basis 再冒充支持。review-data 的投影视图如需 locator，必须另交付显式 projection 版本/摘要合同，当前 ArtifactLocator 不把投影塞入 raw bundle-member。

提交后 resolver 绑定 Revision；trace 文件不写自身 Revision ID。显示态由当前与原 pinned ref 派生：resolved/missing-target/stale-requirement/stale-artifact/unsupported。requirement version 与 elementId 须存在于同 namespace 对象中，sourceId 须存在；不存在的初始端点为 invalid，修改造成旧版本/hash 已变化则保留旧边并显示 stale，不删除旧记录。没有 edge 显示 missing implementation/verification plan，覆盖未知显示 unknown；不同 Revision 同名目标不能自动连接。改变需求/模型时比较 ID/version/hash，再显示显式直接边与已验证 lineage 的依赖闭包；compiler-impact/v2 的 contract/entity/layout/provenance 分开，不把布局移动直接当规则变化。Python 不推断未登记隐藏依赖。

新的 trace 容器顶层 requirementsSha256/elementsSha256 总是绑定当前同版文件；继承边内仍可保存旧 requirement version/locator hash。resolver 依据受信 base 中确实存在的原边区分 inherited stale/missing 与新建非法引用，客户端不能自行声明“历史关系”来绕过校验。旧顶层 digest 原样复制为混版错误；重新生成当前容器并保留旧 pins 才能显示准确 stale。stale/missing 阻止对该需求报告完整覆盖或正式 pass，但不阻止保存待完善模型；unsupported backend/output 仍阻止执行。查看旧代码与旧结论须显式打开其保存 Revision，不以当前同名文件代替。

纯重排改变整文件摘要时，可显式 rebind 对照 ID/version 内容、重新验证 locator，在新 trace 文件保留迁移依据；旧边不可改。partial query、缺 Plan fingerprint 或未知来源不能生成验证闭包，也不构造因果边。

运行验证投影独立于冻结文件：`RequirementEvaluation={requirement:{id,version},revisionId,filesSha256,artifactManifestSha256,runBindingSha256,method,verdict,coverage,authority,recordLocator,gaps}`；verdict 为 not-run/pass/fail/inconclusive/error；authority 为 offline-test/local-unverified/server-computed。recordLocator 绑定实际测试/运行/结果摘要；只有服务端可信收据可标 server-computed，模型自报 URL/JSON 无此权威。

服务端结果也须匹配冻结的需求版本、方法和输入条件。缺指标/单位、公式估计、partial trace 或缺 required case 保持 inconclusive。Browser Preview 成功始终 local/unverified；正式 Experiment/Evidence 沿既有服务端独立冻结输入重算/研究协议，不把浏览器指标升级。过去版本的结论不会自动转移到新版本。

## 5. 同一次 Revision 的产物清单

后续完整 manifest 提议沿用 model/artifacts.json，使用新 schema riffology.model-artifacts/v2（未实现，不由当前 reader 接受）；描述 product subset，不取代完整 archive filesSha256。manifest 不列自己，不包含自己的 hash/Revision ID/archive hash，避免自引用。提交后派生 `{revisionId,filesSha256,manifestSha256}` binding；Revision ID 由原提交协议产生。

```ts
type ArtifactRole = 'model-spec' | 'requirements' | 'sysml-text' | 'sysml-map'
  | 'element-registry' | 'traceability' | 'python-source' | 'server-adapter'
  | 'business-ir' | 'core-ir' | 'compiler-bundle' | 'frontend-manifest'
  | 'frontend-module' | 'visualization' | 'input-data' | 'dependency-lock'
  | 'authoring-result';
type ProductArtifactManifest = {
  schema: 'riffology.model-artifacts/v2';
  files: { path: string; role: ArtifactRole; mediaType: string;
    sha256: string; byteLength: number }[];
  entrypoints: { modelSpec: string; requirements: string | null;
    sysml: string | null; elements: string | null; traceability: string | null;
    compute: string | null; frontend: string | null; visualization: string | null };
  inputData: { id: string; path: string; schema: string; binding: 'saved' }[];
  backendRequirements: BackendRequirements;
};
```

roles 各自有 parser/版本/唯一性/引用约束。path 为受控 ASCII 相对路径，拒绝绝对路径、..、backslash、重复规范路径、symlink 和 URL。文件 hash 使用原字节，不为打包重写数据 JSON；manifest 规范序列化按 ASCII key/files.path 排序。不支持的角色/媒体/schema 明确 unsupported，不能仅 hash 通过就 ready。

设计阶段允许 compute=null，不要求运行 trace；声明可运行的 Python 模型才必需 spec/source/reviewed server-adapter/lock，compute 指向 server-adapter，且与 Spec.execution.entrypoint 一致；compiler 必需 spec/business/bundle，compute 指向 compiler-bundle，且与 Spec.execution.bundle 一致。若额外声明 core-ir，必须与同版 bundle 原成员匹配。model-spec、requirements、sysml-text、sysml-map、element-registry、traceability、frontend-manifest、visualization、dependency-lock 各至多一份，引用必须命中相应 role；input-data/frontend-module/python-source 可多份但入口及闭包明确，禁止重复身份或未声明文件。首版 compute 不接受 Python/compiler 混合调度。声明 requirements/SysML/map/registry/trace 后须整体校验，不从其他 head 补缺。frontend manifest 指定入口及相对模块闭包，各模块声明 role；imports 只落在闭包或预审平台资源。多模块需要新 frontend manifest/profile，不能向现有 browser-js/v1 的 exact keys 临时加 modules/imports。计算与 renderer 分离但共享产物集合。

固定 runtime/wheel/WASM/JS/CSS/Workers/Assets/Widgets 的版本和 hash 由可信 registry 注册；模型不能改 CSP/上限或自报可信依赖。JS 保持既有隔离 frame/宿主验证/消息预算；GIS/Cesium 按 [#151](https://github.com/jihegao/riffology-cloud/issues/151) 注册资源/WebGL能力并真实验收，二维图不标为 Cesium 3D。

新增 reader 预算提议：manifest 64 KiB/64成员；Spec 32 KiB；requirements/SysML 各256 KiB；map/registry 各128 KiB；trace 256 KiB；Python 每份1 MiB；frontend JS 闭包总计128 KiB；input-data 总计256 KiB；lock 64 KiB；authoring-result 128 KiB；compiler bundle 保持现有 Cloud 2 MiB/成员1 MiB。总 Preview package 仍5 MiB；不提高旧 profile 8 KiB输入、8 MiB结果、501帧、30秒等限制。各角色仍受总量约束，预算变化须新 limits/profile digest 和验收。

校验顺序为 archive coverage/hash → manifest/path/budget → roles/schema → 同版引用 → model/IR能力 → frontend/dependency → output。通过后沿 RevisionStore stage/commit 冻结一个 archive；构建只读 committed files，不读 Session/head。保存成功与 Preview ready 分别报告，构建失败不丢源码。Archive 可含其他 Pi Workspace 历史文件，完整摘要保持；Preview 仅打包受控 product subset并报告覆盖，不扫描整个目录执行未声明入口。

旧 v1 五路径/v2 七路径按原 schema 分派，保留原 identity/字节/registry；不回填新 manifest、不重写历史。旧版缺需求/元素身份显示 unavailable，不猜 ID。新能力使用新 Preview schema（提议 browser-preview/v3），旧消费者拒绝未知版本，不能放宽旧 exact-path validator。显式重新保存可从授权旧文件生成新 manifest/ID/Revision，保留原只读历史。需求修订须由 [产物保存项 #182](https://github.com/jihegao/riffology-cloud/issues/182) roles 接线后才成为完整 [需求项 #179](https://github.com/jihegao/riffology-cloud/issues/179) 用户能力。

摘要依赖顺序固定为需求/registry/源文件 → trace → SysML text/map 与 authoring-result → artifact manifest → 完整 archive → Revision receipt → Preview package → run input → result/evaluation。authoring-result 仅绑定当时计算源/输入/依赖摘要，禁止包含最终 Revision/package/manifest 身份，否则它被 manifest 包含后形成 hash 环；最终运行收据与 RequirementEvaluation 在 archive 外追加，绑定提交后身份。manifest entrypoints/backendRequirements 也不引用待生成的 Preview package 或运行结果摘要。

## 6. 输入冻结与后端接口

标量参数由保存 Spec 解析并显式展开 defaults，seed 沿已声明随机合同；播放速度不属于计算输入。时刻表、机场布局、网格初始状态作为 schema 化 input-data 保存。首次编辑结构化数据先保存新 Revision，不支持与模型 Revision 分离的临时上传。读取 config.inputs 需要新 adapter/profile，旧 `{parameters,seed}` 不自动增字段。

```ts
type BackendRequirements = {
  modelFormat: string; semanticProfile: string;
  irVersions: { business: string | null; core: string | null; plan: string | null };
  operationVersions: { name: string; version: string }[];
  rngProfile: string; seedSupport: 'uint32' | 'none';
  parameters: 'runtime-scalars' | 'compiled';
  structuredInputs: { id: string; schema: string;
    stage: 'runtime' | 'compiled' }[];
  outputProtocol: string; observation: ('metrics' | 'frames' | 'recorded-events')[];
};
type FrozenRunInput = {
  schema: 'riffology.run-input/v2';
  revisionId: string; filesSha256: string; artifactManifestSha256: string;
  packageIdentity: string;
  backend: { capabilityId: string; capabilitySha256: string;
    runtimeVersion: string; adapterVersion: string; assetsSha256: string;
    limitsSha256: string; dependencyClosureSha256: string };
  compiled: null | { businessFingerprint: string | null;
    coreFingerprint: string | null; planFingerprint: string;
    bundleId: string | null };
  parameters: Record<string, number | string | boolean>;
  seed: number | null;
  inputData: { id: string; path: string; sha256: string; schema: string }[];
};
```

新 v2 的 seedSupport=uint32 要求 0..4294967295 整数；none 要求 seed=null，明确禁用 seed 控件并显示无随机语义。旧 v1 输入仍要求 uint32，不能静默忽略。Bounded 当前 random_requests=[]，runtime 结果 seed=0 是其固定输出；不解释为用户任意 seed 已生效。需要随机机制的需求必须报告不支持或交付新已验证 profile。

FrozenRunInput 规范内容生成 runBindingSha256；backend 字段必须由平台 registry 解析并核对，不能由 candidate 自报可用；实际 runtime/adapter/assets/limits/capability/依赖闭包 digest 一起绑定请求/结果，不能只有 profile 名称。编译参数已在 Business/Core/Plan 冻结：parameters=compiled 时运行 parameters 必须为空，compiled 对应 loader 核对的 layer 指纹，改变这些参数须 seal/validate/compile/inspect 后保存新 Revision。不能向当前 compiler Spec 加 runtime 参数绕过空参数要求，也不从 standalone Core 反推已丢失的 Business 模板。runtime structured inputs 由新 adapter 读取；compiled structured inputs 必须已参与编译并与原输入/Plan 摘要核对，不能运行时再覆盖 Plan。

inputData 的 id/path/schema/hash 必须逐项匹配 manifest.inputData 和 files 中 input-data role；未知/重复/缺失条目拒绝，不附带未冻结 URL 或内联替代数据。比如提议 `riffology.flight-schedule/v1` JSON 为 `{schema,timeUnit:'seconds',flights:[{id,arrival,departure,standId,arrivalRunwayId,departureRunwayId}]}`；时间相对仿真起点、非负有限且 departure>=arrival，flight ID 唯一，空间 ID 必须指向同版布局 registry。其 schema/validator 和布局合同尚未实现，当前 profile 对此报告 unsupported；表格修改先保存新输入文件和 Revision。机场本地日期/时区、滑行路线与事件规则需要各自显式合同，不从该最小表格声称整个机场验收已完成。

registry 的最小类型如下；一个 capability 对应一个已验证的 format/profile/IR/RNG/参数阶段组合，避免只按 backend 名称放行：

```ts
type BackendCapability = {
  schema: 'riffology.backend-capability/v1'; id: string;
  environment: 'native' | 'browser'; contract: BackendRequirements;
  runtime: { runtimeVersion: string; adapterVersion: string;
    assetsSha256: string; dependencyClosureSha256: string; limitsSha256: string };
  units: string[];
  inputSchemas: { schema: string; schemaSha256: string; validatorVersion: string }[];
  limits: { inputBytes: number; resultBytes: number; frames: number;
    events: number | null; deadlineMs: number };
  controls: { step: 'compute' | 'observe-only' | 'unsupported';
    cancel: 'cooperative' | 'terminate';
    release: 'trusted-receipt' | 'worker-termination' };
  checks: { sourceContractVersion: string; targetCheckVersion: string;
    conformanceReceiptSha256: string };
};
```

capabilitySha256 为平台生成的规范 capability 内容摘要；matchBackend(requirements,capability) 检查 format/profile/IR/RNG/seedSupport/参数阶段精确相符、全部 required operations 的版本已注册、所需 observation/data schemas/单位/预算均有覆盖，并逐项返回缺口诊断。任意 Python 的 operationVersions 可以为空，但这不证明算法正确或全部参数/seed 已被使用；其可复现行为须由目标检查和独立模型测试证明。Agent 给匹配理由，平台再次严格检查；缺口明确拒绝，不删规则、换后端/随机语义或用估算动画冒充计算。旧 PreviewProfileRegistry 不是此新 registry，旧 profile 的 runtimeVersion/adapter/dependency/assets/limits 身份保持原解释；新 registry 要接线及实际 conformance 收据后才能使用。

按 2026-10-12 的建模方向调整，Mesa 是可选依赖；Agent 自主实现算法与 Python/JS，固定六包或源码关键词不能作为未来领域建模准入。依赖校验依据实际环境、完整传递闭包及锁定摘要，新增依赖须经过可复现解析、打包和目标运行时验证。锁定记录至少包括直接声明、全部传递包的 name/version/目标平台/原始资产摘要、解析器版本和闭包摘要；只有已授权 resolver/平台注册资产可装载，模型自给 download URL 不能扩大网络权。旧 profile/包继续按原版本解释，包括已保存 Mesa 包的完整 runtime import closure；本提案不直接修改已部署的依赖与网络策略，也不改变关联 Managed 修复 PR 当前的六根 authoring 范围。Browser 的纯 Python wheel 与 WASM 二进制 wheel 支持须分别检查，参见 [Pyodide 加载包文档](https://pyodide.org/en/stable/usage/loading-packages.html)，native 成功不能替代 browser 成功。该说明页复核时为 314.0.7，不能用 stable 链接升级 Cloud 已锁定的 314.0.6 runtime；实际准入以固定资产/ABI 摘要为准。

Agent 的实现/调试循环在原任务预算内进行：实现 → 目标 runtime 校验/实际运行 → 接收文件/元素/帧/字段诊断 → 有界修正 → 再验证，最终冻结依赖与 Revision。提议 `checkAuthoringTarget({sourceSetSha256,inputSha256,capabilitySha256,attemptId,budget})`，由可信 runner 返回 `{schema:'riffology.authoring-check/v1',attemptId,sourceSetSha256,inputSha256,capabilitySha256,execution,outputSha256,diagnostics,release}`；execution 为 not-started/completed/failed/cancelled/unknown，outputSha256 未产生时为 null，release 为 confirmed/pending。sourceSet 摘要只含计算源/adapter/锁定依赖与输入，不包含自身 check 结果或最终 Revision。诊断按第 7 节合同，工具记录必须能核对实际所载源与输入；输出合同通过与执行完成分开报告，不把 completed 当需求 pass。

有限重试次数、单次及总 deadline、输出预算由任务门禁给出，工具自行减小预算不能增加原授权。已知校验失败可在同一任务内修正后分配新 attempt；执行 unknown 或释放 pending 先核对原 attempt，不自动启动下一次。candidate 自报 trace 即使结构合法也只证明报告数据合同；它不证明代码执行，目标 check 也不等于正式 Evidence。网络/身份隔离、释放检查及原请求隔离继续保留。该循环和诊断工具尚待 [后端执行项 #183](https://github.com/jihegao/riffology-cloud/issues/183) 实现，未宣称当前 Managed 或此 docs PR 已支持。

| 实际计算范围 | 接入边界 |
| --- | --- |
| CPython/Pyodide stdlib、Mesa固定 profile | 已有链；当前标量/grid/lane合同仍适用。JS 消费真实输出，不另造指标计算。 |
| aircraft v0.1 Rust native公共CLI/SDK | [产品合同](https://github.com/jihegao/sim_engine_compiler/blob/ee6a2aa7a66d8bf2609059aaf8a7c0fe22fe8683/docs/v01-product-contract.md) 已实现；[Cloud #122](https://github.com/jihegao/riffology-cloud/issues/122) 普通用户验收独立，Browser不支持。 |
| aircraft-bounded-events/v1 | [layout](https://github.com/jihegao/sim_engine_compiler/blob/ee6a2aa7a66d8bf2609059aaf8a7c0fe22fe8683/src/sim_engine_compiler/compiler/bounded_layout.py) 验证 operations/backend 后解析symbols；[runtime](https://github.com/jihegao/sim_engine_compiler/blob/ee6a2aa7a66d8bf2609059aaf8a7c0fe22fe8683/src/sim_engine_compiler/domains/aircraft_support/bounded_runtime.py) 独立validate Plan，以EventCalendar/CapacityLedger计算。Python-only，无随机请求；公共simpack/Rust/Cloud未采用。 |
| ABM Business/Core/Tick Plan、reference/Rust native | [IR版本](https://github.com/jihegao/sim_engine_compiler/blob/ee6a2aa7a66d8bf2609059aaf8a7c0fe22fe8683/src/sim_engine_compiler/ir/abm.py) 保持v1；[Rust runtime](https://github.com/jihegao/sim_engine_compiler/blob/ee6a2aa7a66d8bf2609059aaf8a7c0fe22fe8683/rust/runtime/src/abm_runtime.rs) 已有独立 AbmRunResult/events/random_requests、seed/sample/random-tape 请求类型。public aircraft package/review不支持ABM。远端ABM/runtime更新没有全面复核，新增行为/安装链待 [compiler #549](https://github.com/jihegao/sim_engine_compiler/issues/549) 审计，不宣称Cloud已接入。 |
| Queue/机场组合DES/地面运动 | 先审计现有有限事件/resource能力，在 [compiler #550](https://github.com/jihegao/sim_engine_compiler/issues/550) 定义缺失的最小可复用operation。不能包整个案例当通用primitive。 |
| Rust/WASM、compiler Browser Preview | [compiler #551](https://github.com/jihegao/sim_engine_compiler/issues/551) 尚未交付；注册新能力前 unavailable，不能以JS重算替代同一Rust运行。 |

WASM 规划接口：固定 Worker 内预审 runtime 接受同一验证 Plan，`validatePlan(plan,capabilityDigest)`、`start(plan,input)`、`observe(cursor,budget)`、`cancel(runId)`、`release(runId)` 返回有界 metrics/frames/events。RunState 私有且在Plan外，不为每个模型在线 cargo build。只有profile声明 step 才是计算步进，否则UI是已生成frame的单步播放。native/reference/WASM 时间排序、RNG、资源、终态和指标需独立 conformance；此接口尚未实现。

指标补充 `{key,value,unit,method:'measured'|'formula-estimate',outputLocator,coverage}`；measured 绑定真实输出pointer/frame/event与输入身份。缺字段/非有限值/单位或估计依据不明为unknown/invalid。动画位置来自计算或标明的显示插值；插值不改变事件时钟、资源占用和实测指标。

## 7. 恢复、诊断与负例

提议 `resolveSavedArtifacts(authorizedSource)` 返回 `{binding,manifest,requirements,sysmlMap,elements,traceability,diagnostics}`，全部来自一个committed archive；gateway先授权，reader再验scope/receipt/hash。不足不回退head。用户草稿按user/project/base Revision分区，存inputs hash；旧视图/结果与新草稿显示各自身份。刷新只恢复内容和历史，不启动Turn/Run/编译/provider重放。

明确重新运行才冻结新输入；play/pause/step/reset默认作用于结果游标。退出/刷新/取消销毁frame/Worker、确认释放；后端unknown按原请求隔离核对，不用新项目/profile绕过。线上门禁、付费政策、kill switch与原停止条件不由本设计扩张。

诊断合同为 `{schema:'riffology.artifact-diagnostic/v1',code,severity,stage,path,pointer,elementId,frame,field,message}`；不适用locator为null；stage为archive/manifest/requirements/sysml/model/inputs/backend/frontend/output。error拒绝该操作，warning表示明确partial/stale；unsupported不能降为warning继续运行。message指出具体文件/元素/帧/字段，不泄漏凭据或bucket key。

| 负例 | 必须结果 |
| --- | --- |
| 重排重新分配ID、覆盖历史、重复ID/版本 | requirement/pointer精确identity/history错误。 |
| Agent自报confirmed、伪造action、quote不符 | source/action/requirement定位，拒绝确认。 |
| 单位/阈值未知、生成恒真requirement | unresolved/unsupported，不自动pass。 |
| 分组/层级/派生循环、自引用、悬空ref | relation ID及端点，invalid。 |
| requirements改而SysML/map/trace仍旧 | 文件与版本定位，stale/拒绝混版。 |
| Python locator不存在、index当稳定ID、混bundle | element/member/pointer，missing/invalid。 |
| module未声明、remote import、依赖hash不符 | 文件/import字段，unsupported/invalid。 |
| 重复flight ID、布局引用不存在、时间单位错 | input-data行/字段，运行前拒绝，不替用户改数据。 |
| 未声明lane、越界grid、时间倒退、超frames | output frame/agent/field定位，不显示完成。 |
| 编译参数未reseal、ABM进aircraft loader、WASM缺op | artifact/profile/op缺口，无fallback。 |
| bounded宣称任意seed生效、local自报server-computed | randomness/authority错误，不生成正式结论。 |
| 旧源缺失、unknown刷新、撤权读取 | 固定source/request/scope原因，不回退/重放。 |

## 8. 最小可编码切口与本次检查

[需求项 #179](https://github.com/jihegao/riffology-cloud/issues/179) 首个切口是 `services/requirements/schema.ts` 及纯 source/history validator：严格 schema、稳定 ID/version 前缀、UTF-8 source 范围、DAG、quantitative unknown 与 confirmation receipt port；机场/Queue/网格离线需求 fixture 及上述失败例子。无 provider/仿真/UI 调用，通过只证明数据合同。

建议的纯函数边界为 `validateRequirements({previous,next,context}) -> {status,artifact,diagnostics}`；context 提供已授权解析的 source targets、可信 action 收据、namespace 及可用 element/input/metric ID 集合，函数自身不联网、不调用 provider/仿真、不写库。status 为 valid/partial/invalid/unsupported：schema/history/伪确认等错误为 invalid，未知版本为 unsupported，可保存但尚无形式化单位/来源全文的内容为 partial，artifact 仅在 valid/partial 返回。没有源正文时不通过 excerpt 核实，只有旧版已核实记录或明确 caller-asserted 事实可保留；新确认仍需用户 action。context 不是候选文件的一部分，调用服务必须先验证授权与收据。

离线 fixture 的最小内容分别为：机场的班表/机位/周转指标及未确认假设，Queue 的到达/服务/容量与等待指标，网格生态的格子/个体/seed 与数量指标；来源为标注的 synthetic Turn/action 数据，不宣称真实对话抽取或真实仿真。每份包含提出→用户编辑→确认→撤回的连续版本；另外检查重排保持 ID、128来源复用/第129来源拒绝、第33历史版本拒绝、旧 confirmed 正文被 Agent 改写须回 proposed、空 sourceIds/悬空 source/action/CAS 不匹配、UTF-8 多字节错误、循环及 null 阈值。该测试切口消费本合同，不需要先实现 SysML parser 或付费 Agent，具体 fixture/test 尚未在本 docs PR 编写。

接线顺序由合同依赖决定：[产物保存项 #182](https://github.com/jihegao/riffology-cloud/issues/182) 统一 roles 容纳需求文件，再从 saved-files resolver 展示；confirm API 验证用户收据，生成新文件快照并沿 RevisionStore 提交。[SysML #180](https://github.com/jihegao/riffology-cloud/issues/180)、[trace #181](https://github.com/jihegao/riffology-cloud/issues/181)、[后端 #183](https://github.com/jihegao/riffology-cloud/issues/183)、[视图 #184](https://github.com/jihegao/riffology-cloud/issues/184)、[恢复 #185](https://github.com/jihegao/riffology-cloud/issues/185) 均消费同一 frozen binding，不复制 head。reader 未支持新 role 前，不宣称邀请用户完整流程完成。

本次仅文档：读 Issue/PR 最新范围与评论、Cloud 源码、engine 本地及上述远端有限补审、OMG 官方资料和库；没有修改 engine 或原主工作区，没有运行 SysML checker、仿真、线上验收/付费模型，也没有部署/正式 Evidence。检查为文档引用/事实/字段与 git diff --check；设计文档供实现评审，实际评审/合并状态见 [PR #189](https://github.com/jihegao/riffology-cloud/pull/189) 与 [需求 Issue](https://github.com/jihegao/riffology-cloud/issues/179)。checker/生产实现/保存接线及真实跨领域验收仍 pending，不属于本 PR 已交付能力。CI 账户侧未启动的检查保持未执行，不记通过。
