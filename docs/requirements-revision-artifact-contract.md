# 需求、追溯与版本化模型产物合同（提案 v1）

日期：2026-10-12。负责人：@jihegao。对应 [#179](https://github.com/jihegao/riffology-cloud/issues/179) 的第一阶段设计，父项 [#177](https://github.com/jihegao/riffology-cloud/issues/177)。本文是接口设计，尚未实现、部署或验收；设计评审通过不能关闭 #179。范围、依赖和交付阶段以 Issue / Delivery Project 为准，本文不另建任务状态表。

源码基线：Cloud `25609953f5c3b69dcb44e520d7e7ed1253d18fe4`；compiler GitHub main `ee6a2aa7a66d8bf2609059aaf8a7c0fe22fe8683`。最初本地 compiler `a1a44c7` 落后远端；补读了远端 bounded profile、layout/runtime 及 ABM 版本常量。以下新 schema、类型、函数、路径均为提议，尚未注册到生产 reader、Managed 或 Browser Preview。未全面复审这八个远端提交，也未重新执行它们的测试。

## 1. 扩展点与现有边界

| 已核对入口 | 实际能力与扩展位置 |
| --- | --- |
| [Turn 协议](../services/turn/protocol.ts)、[Revision](../services/turn-runtime/revision.ts)、[RevisionStore](../services/turn-runtime/revision-store.ts) | CheckpointReceipt 已绑定 Revision、完整 archive 与 Session 摘要；create-only R2 对象读回核对，TurnJournal 保留 head 提交权威。新模型产物进入同一次冻结文件快照，不引入第二个可变模型 head。 |
| [candidate artifact](../services/turn-runtime/candidate-artifact.ts) | archive 已校验文件清单、长度与摘要；packageCandidateModel 可包装 Python/compiler Spec，但不等于需求、前端或 trace 已完整校验。 |
| [Managed](../services/turn-runtime/managed-product.ts)、[生成指令](../services/turn-runtime/managed-testing-instructions.ts) | 当前交互候选限定三个 UTF-8 文件，恢复仅取 Python/Spec/lock；指令写死 road，包阶段强制 lane。扩展 reader 前不能声称本文 manifest 已支持。 |
| [Model Spec](../services/simulation/model-spec.ts) | v1 接受标量参数和有限数值指标；compiler-v01 要求空 runtime parameters。旧 entities/mechanisms/assumptions 字符串数组不提供稳定需求或元素身份。 |
| [Preview contract](../services/browser-preview/contract.ts)、[profiles](../services/browser-preview/profiles.ts)、[视觉协议](../services/browser-preview/runtime/protocol.mjs) | browser-preview/v1 固定五路径，v2 再加固定 frontend manifest/main 两路径；两种 Python profile，grid/lane 输出。多模块、结构化输入、IR/WASM 不属于这些旧合同。 |
| [compiler authoring](compiler-v01-authoring.md)、[bundle inspector](../services/simulation/compiler-bundle.ts) | 同版保存 Business IR、simpack、Spec；Cloud 固定 aircraft v0.1 合同；Browser Preview 未支持 compiler bundle。 |
| [release-readiness](release-readiness.md) | 浏览器本地 Runs 已记录一个认证 owner 的验收；其他身份/计数/云端失败覆盖分开记录。本文不改变部署或验收结论。 |

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
      eventId: string; sequence: number }
  | { kind: 'saved-file'; path: string; sha256: string; pointer: string | null }
  | { kind: 'user-action'; actionId: string };
type RequirementSource = {
  id: string; locator: SourceLocator; contentSha256: string;
  span: { startByte: number; endByte: number } | null;
  excerpt: string; resolution: 'resolved' | 'unavailable' | 'caller-asserted';
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

version 从 1 连续增加；已有 versions 前缀必须与原保存文档的规范投影逐项相同；currentVersion 指向末项。编辑、确认、撤回追加版本，不能覆盖或删除历史。撤回标 retired；重新提议/确认均追加版本。Agent 假设确认后保留 agentSupplement 与最初来源，不改成用户原话。

用户来源用实际 TurnRecord.message，不虚构目前不存在的 user message ID；助手来源用实际 TurnEvent ID/sequence。span 是原正文 UTF-8 字节半开区间并落在字符边界，excerpt 必须等于该片段；contentSha256 绑定被引用原正文。不可先归一化 Unicode/空白再声称原话。只保存有界摘录；完整来源经授权读取，不打包聊天、Session 或凭据。历史来源不可用时显示 unavailable，保留当时摘录和摘要，不伪造补全。

确认不能只相信 candidate JSON 的 actorKind。Agent 新建/改写只能 proposed；保留原 confirmed 记录须匹配旧快照。confirm/retire/reopen 必须由授权用户 action 持久收据证明，绑定 actor/project/base Revision/requirement ID/version/修改摘要。提交服务验证收据后生成文件快照；Agent 自造 actionId 拒绝。来源解析和 confirmation receipt port 尚未实现，不称为当前 TurnJournal 已有 API。

纯用户编辑不能伪装成 provider Turn。提议作者保存 port `commitAuthoringEdit({scope,actor,baseRevision,actionId,changeSha256,filesArchive})`，返回原形态 CheckpointReceipt；在同一 RevisionStore/Workspace head CAS 中提交，保留旧 Session/backend 状态。现有 writer 的 saved-turn manifest/key/reader 不能直接承载此来源：接线 PR 必须增加显式 user-edit provenance、版本分派及授权/并发检查，保留 schema 3/4 原解释，禁止制造 TurnRuntimeIdentity 来绕过。这一手动保存扩展尚未实现；在它接入前，确认可作为待保存草稿，不能标为已冻结 Revision，也不能自动发起付费 Turn。

阈值、单位、聚合或 scenario 未确定时保留 null；不得补默认成功、把 null 当 0。确认状态、实现覆盖和验证结果独立。groups 仅用于导航；parentRequirementId 表示语义子需求，subject 绑定必须明确。派生与层级不互相推断；Riffology v1 额外限制两种图为 DAG，这属于本产品支持子集。

首版 validator 预算提议：文件 256 KiB；512 个需求、每项最多 32 个历史版本；128 sources，每段摘录 2 KiB；正文 8 KiB、标题 256 字节；512 条派生、每条 32 个目标；层级 16。计数与字节同时受限，超过明确拒绝，不能裁剪历史。

## 3. SysML 2.0 展示子集

语义依据固定 [OMG SysML 2.0](https://www.omg.org/spec/SysML/2.0) 的 [Language formal/2026-03-02，March 2026](https://www.omg.org/spec/SysML/2.0/Language/PDF)。产品子集版本提议 `riffology.sysml-requirements/1`，不声明完整 SysML 合规。

| 产品对象 | 子集映射 | 边界 |
| --- | --- | --- |
| 分组、来源、确认状态 | package；产品状态/来源置 sidecar | 导航包含不产生满足语义。 |
| 需求 | requirement definition/usage、doc、稳定生成名称与 short name | §7.21 / §8.2.2.21；研究问题单独标注，不自动变成必须成立的 requirement。 |
| 子需求/subject | composite requirement usage、明确 subject 绑定 | 不猜未声明 subject，不把导航层级当语义组合。 |
| 可形式化假设/要求 | assume/require constraint | 仅支持固定有单位标量比较和布尔组合；未知文本保留 doc/unresolved，不能生成恒真表达式。 |
| 明确满足断言 | satisfy requirement usage | 是作者模型断言，普通 implements 边不自动升级为 satisfy 或通过。 |
| 验证计划 | verification definition/usage、objective 中 verify | §7.24 / §8.2.2.24；建立 case 不产生 verdict。 |
| 派生 | §9.6 Requirement Derivation Domain Library | 采用 originalRequirement → derivedRequirements 的库端点，不套 SysML v1 deriveReqt。 |

文本/图形投影依据 §8.2.2.21/24、§8.2.3.21/24；语义关系依据 §7.21、§7.24、§9.6。派生库固定 [OMG ptc/25-04-30 KPAR](https://www.omg.org/spec/SysML/20250201/Requirement-Derivation-Domain-Library.kpar)，本次只读下载 SHA-256 `a136e72ac6afbd96ede220cfec77fd54c75242d577d3f5ab9e5278b25baee6e5`。实现时还须固定 Systems/Kernel/所用 Quantities and Units 的字节摘要，不追随 latest。

生成文件为 requirements/requirements.sysml 与 requirements/sysml-map.json。JSON 是编辑权威，SysML 为确定性导出。后续文本编辑须通过受限 parser 转为需求修改并保存新 Revision；不能只改 text 而 JSON/map 沿用旧身份。首版不支持任意 SysML 导入、未知 imports/网络库、完整行为执行或任意单位代数。

map 合同：`{schema:'riffology.sysml-map/v1',subsetVersion,requirementsSha256,textSha256,libraryPins,checkerPin,mappings,omissions}`；每条 mapping 为 `{namespaceId,requirementId,requirementVersion,qualifiedName,startByte,endByte}`；omission 为元素/需求定位、reasonCode 和缺口。导出错误不能与旧 text/map 混用。源/confirmation/本地证据留 sidecar，不伪装标准 verdict。

两层校验：本仓库有限 AST/semantic validator（提议 riffology.sysml-subset-validator/1）检查 names/subject/端点/单位/sidecar；另用官方 [Pilot 2026-03，Eclipse plugin 0.58.0](https://github.com/Systems-Modeling/SysML-v2-Pilot-Implementation/releases/tag/2026-03) 离线检查文本兼容。[库发布基线](https://github.com/Systems-Modeling/SysML-v2-Release/releases/tag/2026-03) 为 commit cd99f7ca70b96abb38f09dfd25725e3cf259baa3。Pilot 含修复先行实现，不能取代 formal 语义。本次未安装/运行 checker；安装闭包、命令和生成语法的实际验证 pending，实施 PR 固定摘要后才可报告 checker 通过。

视图由同一 AST/map 生成，点选显示详情、来源、确认、派生、满足断言和验证计划；missing/unresolved/unsupported 可见。当前这些 exporter/parser/交互视图均未实现。完整 KerML/SysML 编辑/导入、执行、认证交换与自动证明不属于该子集。

## 4. 稳定模型元素、定位与追溯

提议 model/elements.json，schema riffology.elements/v1：`{namespaceId,elements:[{id,kind,label,basis,locators}]}`。kind 为 entity/resource/space/event/rule/constraint/parameter/metric/code/test；basis 为 author-declared 或 compiler-validated。Python 显式 registry 关联作者元素 ID 到符号/字段/代码段；定位存在不证明 Python 完整语义。重命名保持作者元素 ID，旧 registry 留在旧版。

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
  basis: 'author-declared' | 'validated-compiler-lineage'; sourceId: string;
};
type TraceArtifact = {
  schema: 'riffology.traceability/v1'; namespaceId: string;
  requirementsSha256: string; elementsSha256: string; edges: TraceEdge[];
};
```

path 只在同一保存 archive 的已声明 roles 中解析，核对 hash/pointer/span，不接收文件系统绝对路径或 R2 key。Compiler 使用 layer/kind/stable symbol/fingerprint；simpack 通过已验证 loader 取 raw member，不把 review report 当 raw bundle。跨层展开保持一对多、association_status、partial 和遗漏；同版 Business/Core/Plan/lineage 全部验证后才能标 validated-compiler-lineage。新 bounded/ABM 若尚无相同公共 lineage 合同，使用该 profile 自身已验证 source map 并明示 basis，不能改名冒充 lineage/v2。

提交后 resolver 绑定 Revision；trace 文件不写自身 Revision ID。显示态由当前与原 pinned ref 派生：resolved/missing-target/stale-requirement/stale-artifact/unsupported。没有 edge 显示 missing implementation/verification plan，覆盖未知显示 unknown；不同 Revision 同名目标不能自动连接。改变需求/模型时比较 ID/version/hash，再显示显式直接边与已验证 lineage 的依赖闭包；compiler-impact/v2 的 contract/entity/layout/provenance 分开，不把布局移动直接当规则变化。Python 不推断未登记隐藏依赖。

纯重排改变整文件摘要时，可显式 rebind 对照 ID/version 内容、重新验证 locator，在新 trace 文件保留迁移依据；旧边不可改。partial query、缺 Plan fingerprint 或未知来源不能生成验证闭包，也不构造因果边。

运行验证投影独立于冻结文件：`RequirementEvaluation={requirement:{id,version},revisionId,filesSha256,artifactManifestSha256,runBindingSha256,method,verdict,coverage,authority,recordLocator,gaps}`；verdict 为 not-run/pass/fail/inconclusive/error；authority 为 offline-test/local-unverified/server-computed。recordLocator 绑定实际测试/运行/结果摘要；只有服务端可信收据可标 server-computed，模型自报 URL/JSON 无此权威。

服务端结果也须匹配冻结的需求版本、方法和输入条件。缺指标/单位、公式估计、partial trace 或缺 required case 保持 inconclusive。Browser Preview 成功始终 local/unverified；正式 Experiment/Evidence 沿既有服务端独立冻结输入重算/研究协议，不把浏览器指标升级。过去版本的结论不会自动转移到新版本。

## 5. 同一次 Revision 的产物清单

提议 model/artifacts.json，schema riffology.model-artifacts/v1；描述 product subset，不取代完整 archive filesSha256。manifest 不列自己，不包含自己的 hash/Revision ID/archive hash，避免自引用。提交后派生 `{revisionId,filesSha256,manifestSha256}` binding；Revision ID 由原提交协议产生。

```ts
type ArtifactRole = 'model-spec' | 'requirements' | 'sysml-text' | 'sysml-map'
  | 'element-registry' | 'traceability' | 'python-source' | 'server-adapter'
  | 'business-ir' | 'core-ir' | 'compiler-bundle' | 'frontend-manifest'
  | 'frontend-module' | 'visualization' | 'input-data' | 'dependency-lock'
  | 'authoring-result';
type ProductArtifactManifest = {
  schema: 'riffology.model-artifacts/v1';
  files: { path: string; role: ArtifactRole; mediaType: string;
    sha256: string; byteLength: number }[];
  entrypoints: { modelSpec: string; requirements: string | null;
    sysml: string | null; elements: string | null; traceability: string | null;
    compute: string; frontend: string | null; visualization: string | null };
  inputData: { id: string; path: string; schema: string; binding: 'saved' }[];
  backendRequirements: BackendRequirements;
};
```

roles 各自有 parser/版本/唯一性/引用约束。path 为受控 ASCII 相对路径，拒绝绝对路径、..、backslash、重复规范路径、symlink 和 URL。文件 hash 使用原字节，不为打包重写数据 JSON；manifest 规范序列化按 ASCII key/files.path 排序。不支持的角色/媒体/schema 明确 unsupported，不能仅 hash 通过就 ready。

Python 必需 spec/source/reviewed server-adapter/lock；compiler 必需 spec/business/bundle。声明 requirements/SysML/map/registry/trace 后须整体校验，不从其他 head 补缺。frontend manifest 指定入口及相对模块闭包，各模块声明 role；imports 只落在闭包或预审平台资源。计算与 renderer 分离但共享产物集合。

固定 runtime/wheel/WASM/JS/CSS/Workers/Assets/Widgets 的版本和 hash 由可信 registry 注册；模型不能改 CSP/上限或自报可信依赖。JS 保持既有隔离 frame/宿主验证/消息预算；GIS/Cesium 按 [#151](https://github.com/jihegao/riffology-cloud/issues/151) 注册资源/WebGL能力并真实验收，二维图不标为 Cesium 3D。

新增 reader 预算提议：manifest 64 KiB/64成员；Spec 32 KiB；requirements/SysML 各256 KiB；map/registry 各128 KiB；trace 256 KiB；Python 每份1 MiB；frontend JS 闭包总计128 KiB；input-data 总计256 KiB；lock 64 KiB；authoring-result 128 KiB；compiler bundle 保持现有 Cloud 2 MiB/成员1 MiB。总 Preview package 仍5 MiB；不提高旧 profile 8 KiB输入、8 MiB结果、501帧、30秒等限制。各角色仍受总量约束，预算变化须新 limits/profile digest 和验收。

校验顺序为 archive coverage/hash → manifest/path/budget → roles/schema → 同版引用 → model/IR能力 → frontend/dependency → output。通过后沿 RevisionStore stage/commit 冻结一个 archive；构建只读 committed files，不读 Session/head。保存成功与 Preview ready 分别报告，构建失败不丢源码。Archive 可含其他 Pi Workspace 历史文件，完整摘要保持；Preview 仅打包受控 product subset并报告覆盖，不扫描整个目录执行未声明入口。

旧 v1 五路径/v2 七路径按原 schema 分派，保留原 identity/字节/registry；不回填新 manifest、不重写历史。旧版缺需求/元素身份显示 unavailable，不猜 ID。新能力使用新 Preview schema（提议 browser-preview/v3），旧消费者拒绝未知版本，不能放宽旧 exact-path validator。显式重新保存可从授权旧文件生成新 manifest/ID/Revision，保留原只读历史。需求修订须由 #182 roles 保存接线后才成为完整 #179 用户能力。

## 6. 输入冻结与后端接口

标量参数由保存 Spec 解析并显式展开 defaults，seed 沿已声明随机合同；播放速度不属于计算输入。时刻表、机场布局、网格初始状态作为 schema 化 input-data 保存。首次编辑结构化数据先保存新 Revision，不支持与模型 Revision 分离的临时上传。读取 config.inputs 需要新 adapter/profile，旧 `{parameters,seed}` 不自动增字段。

```ts
type BackendRequirements = {
  modelFormat: string; semanticProfile: string;
  irVersions: { business: string | null; core: string | null; plan: string | null };
  operationVersions: { name: string; version: string }[];
  rngProfile: string; seedSupport: 'uint32' | 'none';
  parameters: 'runtime-scalars' | 'compiled';
  structuredInputs: { id: string; schema: string }[];
  outputProtocol: string; observation: ('metrics' | 'frames' | 'recorded-events')[];
};
type FrozenRunInput = {
  schema: 'riffology.run-input/v2';
  revisionId: string; filesSha256: string; artifactManifestSha256: string;
  packageIdentity: string;
  parameters: Record<string, number | string | boolean>;
  seed: number | null;
  inputData: { id: string; path: string; sha256: string; schema: string }[];
};
```

新 v2 的 seedSupport=uint32 要求 0..4294967295 整数；none 要求 seed=null，明确禁用 seed 控件并显示无随机语义。旧 v1 输入仍要求 uint32，不能静默忽略。Bounded 当前 random_requests=[]，runtime 结果 seed=0 是其固定输出；不解释为用户任意 seed 已生效。需要随机机制的需求必须报告不支持或交付新已验证 profile。

FrozenRunInput 规范内容生成 runBindingSha256；实际 backend runtime/adapter/assets/limits/capability digest 一起绑定请求/结果，不能只有 profile 名称。编译参数已在 Business/Core/Plan 冻结；修改须 seal/validate/compile/inspect 后保存，不能向当前 compiler Spec 加 runtime 参数绕过空参数要求。

registry 精确列出 model/schema/profile/op/RNG/单位/数据 schema、native/browser、观测/预算、参数作用阶段和 cancel/release 能力。Agent 给匹配理由，平台再次严格检查；缺口明确拒绝，不删规则、换后端/随机语义或用估算动画冒充计算。

按 2026-10-12 的建模方向调整，Mesa 是可选依赖；Agent 自主实现算法与 Python/JS，固定六包或源码关键词不能作为领域建模准入。依赖校验依据实际环境、完整传递闭包及锁定摘要，新增依赖须经过可复现解析、打包和目标运行时验证。旧 profile/包继续按原版本解释；本提案不直接修改已部署的依赖与网络策略。Browser 的纯 Python wheel 与 WASM 二进制 wheel 支持须分别检查，参见 [Pyodide 加载包文档](https://pyodide.org/en/stable/usage/loading-packages.html)，native 成功不能替代 browser 成功。

Agent 的实现/调试循环在原任务预算内进行：实际运行、接收文件/元素/帧/字段诊断、修正、再验证，最终冻结依赖与 Revision。候选自报 trace 不证明代码执行；调试工具和目标运行时需保留可核对记录。网络/身份隔离、时限/输出预算及释放检查继续保留，未知执行沿原请求隔离核对，不能借调试自动重放。该循环和诊断工具尚待 #183 实现，未宣称当前 Managed 已支持。

| 实际计算范围 | 接入边界 |
| --- | --- |
| CPython/Pyodide stdlib、Mesa固定 profile | 已有链；当前标量/grid/lane合同仍适用。JS 消费真实输出，不另造指标计算。 |
| aircraft v0.1 Rust native公共CLI/SDK | [产品合同](https://github.com/jihegao/sim_engine_compiler/blob/ee6a2aa7a66d8bf2609059aaf8a7c0fe22fe8683/docs/v01-product-contract.md) 已实现；#122 普通用户验收独立，Browser不支持。 |
| aircraft-bounded-events/v1 | [layout](https://github.com/jihegao/sim_engine_compiler/blob/ee6a2aa7a66d8bf2609059aaf8a7c0fe22fe8683/src/sim_engine_compiler/compiler/bounded_layout.py) 验证 operations/backend 后解析symbols；[runtime](https://github.com/jihegao/sim_engine_compiler/blob/ee6a2aa7a66d8bf2609059aaf8a7c0fe22fe8683/src/sim_engine_compiler/domains/aircraft_support/bounded_runtime.py) 独立validate Plan，以EventCalendar/CapacityLedger计算。Python-only，无随机请求；公共simpack/Rust/Cloud未采用。 |
| ABM Business/Core/Tick Plan、reference/Rust native | [IR版本](https://github.com/jihegao/sim_engine_compiler/blob/ee6a2aa7a66d8bf2609059aaf8a7c0fe22fe8683/src/sim_engine_compiler/ir/abm.py) 保持v1；public aircraft package/review不支持ABM。远端ABM/runtime更新没有全面复核，新增行为/安装链待 #549审计，不宣称Cloud已接入。 |
| Queue/机场组合DES/地面运动 | 先审计现有有限事件/resource能力，在 #550 定义缺失的最小可复用operation。不能包整个案例当通用primitive。 |
| Rust/WASM、compiler Browser Preview | #551 尚未交付；注册新能力前 unavailable，不能以JS重算替代同一Rust运行。 |

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

评审后 #179 首个切口是 `services/requirements/schema.ts` 及纯source/history validator：严格schema、稳定ID/version前缀、UTF-8 source范围、DAG、quantitative unknown与confirmation receipt port；机场/Queue/网格离线需求fixture及上述失败例子。无provider/仿真/UI调用，通过只证明数据合同。

接线顺序由合同依赖决定：#182统一roles容纳需求文件，再从saved-files resolver展示；confirm API验证用户收据，生成新文件快照并沿RevisionStore提交。#180 SysML、#181 trace、#183后端、#184视图、#185恢复均消费同一frozen binding，不复制head。reader未支持新role前，不宣称邀请用户完整流程完成。

本次仅文档：读Issue、Cloud源码、engine本地及上述远端有限补审、OMG官方资料和库；没有修改engine或原主工作区，没有运行SysML checker、仿真、线上验收/付费模型，也没有部署/正式Evidence。检查为文档引用/事实/字段与git diff --check；阶段结论是设计待评审，checker/生产实现/真实跨领域验收仍pending。
