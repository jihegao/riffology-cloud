# Browser Preview 包与保存状态契约

日期：2026-09-15。阶段 0A / 1A；状态：schema、确定性校验/打包和条件对象存储协议本地通过；真实平台资产待 runtime 提供，授权/持久编排待阶段 2 实现。关联 #64。执行/隔离协议由阶段 0B 独占；此文档定义内容身份与平台交接，不声称任意 Python 可以安全执行。

## 1. 保存源码与包身份

schema 固定 `riffology.browser-preview/v1`，未知字段、未知版本、重复路径和额外路径一律拒绝。源码必须来自已授权、已验证摘要的保存 Revision 文件读取接口，不从可变 Workspace head 或完整 Pi Session restore 读取。

| 原始保存路径 | 包内路径 | 用途 |
| --- | --- | --- |
| `model/model.py` | `model/model.py` | 两端共享模型，`run({parameters,seed})` |
| `model/run.py` | `model/run.py` | 服务器适配入口 |
| `model/model-spec.json` | `model/model-spec.json` | 已有严格 Model Spec |
| `model/visualization.json` | `model/visualization.json` | 声明式 renderer 输入 |
| `app/requirements.lock` | `app/requirements.lock` | 已有 JSON dependency lock |

这是对 issue 根级 `visualization.json` 示例的明确调整，以兼容 publication/readiness 与 runtime/content 白名单。不得向 Model Spec 填任意 runtime 字段或移动 dependency lock。首版只含这五个文件，不能打入凭据、聊天、Session、capability、工具控制状态或模型生成的前端 JS。缺额外 Python 模块的模型返回固定 unsupported 原因，不能偷偷打整个目录。

`PreviewPackageIdentityInput` 包括 `schema,projectId,revisionId,filesSha256,sources,runtime`。`sources` 为五条 `{path,sha256,byteLength}`，原字节不重写。`filesSha256` 是保存文件 archive 摘要，不能以五条子集摘要冒充。runtime 包括 `profileId,runtimeVersion,adapterVersion,pythonVersion,assetSha256,visualProtocol,limitsSha256,dependencies`；每条 dependency 为 name/version/sha256，必须包含平台注册完整闭包。`assetSha256` 覆盖平台固定 runtime 资产清单（路径、摘要、长度），阶段 1 制作并审核真实清单。包不决定自己的可信资产目录。`visualProtocol` 固定 `riffology.visual/v0.1`；`limitsSha256` 绑定执行契约的平台固定上限对象，具体请求/源码/输入/结果/frame/agent/step/超时/cache限制由0B定义，阶段1 registry完整比对，消费者不能自行提高。固定上限对象为 `{inputBytes:8192,resultBytes:8388608,frames:501,agentsPerFrame:10000,gridCells:1000000,deadlineMs:30000,maxSteps:500,cacheBytes:8388608,sourceBytes:1048576,bundleBytes:5242880}`，按canonicalPreviewJson摘要。maxSteps只约束声明名steps的普通参数；horizon由Spec定义时间范围，不能静默转换步数。超时与资源检查可强制终止Worker，但不宣称硬进程内存隔离。

profile 为 `python-stdlib/v1`、`mesa-3.5.1/v1`。起点为 `pyodide-314.0.6/v1`、Python `3.14.2`、`riffology.model-run/v1`；Mesa 不仅依赖 Mesa，阶段 1 必须解析并固定完整递归闭包。schema 仅校验数据形状，包 validator 另须与可信 profile registry 完整匹配。fixture 的重复十六进制摘要是合成测试数据，不能用于 ready 或发布。

身份是规范 JSON 的 SHA-256：对象 key 按 ASCII 排序；sources 按上表排序；dependencies 按 name ASCII 排序。完整 manifest 增加 `packageIdentity`；它不参与自身摘要。同一保存源码和 profile 得到同一身份。生成时间、重试次数和状态更新日期不进 manifest/包字节。阶段 1 固定 archive 格式、entry 顺序和零时间戳；包对象字节摘要与 packageIdentity 分别记录，不能把语义身份误当作对象字节摘要。runtime 升级留存旧 registry 与解释能力，不能把旧包指向新依赖。

## 2. saved 触发与持久构建

构建跟随 checkpoint 的 durable `saved` 事实，包括最终 failed/cancelled 但已保存文件的 Turn；不只监听 `turn.completed`。保存完成不依赖构建成功。阶段 2A 独占 journal/store/Workspace 的持久派生意图和补发现机制；第一次调度前先保存 Revision 引用保护和 build intent。identity 验证可在后台进行，禁止阻塞 Pi 释放。

| 状态 | 精确定义 |
| --- | --- |
| `not_requested` | 当前 Revision/profile 尚无构建意图；既不表示 unsupported，也不表示任务在队列中 |
| `building` | 持久构建意图已记录，含稳定 buildIdentity 与有界 attempt；重启继续同一意图 |
| `ready` | create-only 对象已校验摘要/长度且持久收据已写入；含 packageIdentity 与对象摘要/长度 |
| `unsupported` | 确定性源码兼容拒绝，不自动当暂时失败重试 |
| `failed` | 构建/读取/存储暂时或内部失败，保留同一输入身份，按有界策略重试 |

`stale` 仅只读 API 按 build.revisionId 与当前 head 派生，不能成为第六种持久状态或改写旧 ready。同一 Revision/profile 的 source 已知后，buildIdentity 等于 packageIdentity；之前的 intent key 用授权 scope+revisionId+完整 profile digest 推导，不能只用可变 profileId。迟到旧任务只能更新自己的行。状态变化以持久 CAS/版本约束实现；阶段 2A 补充具体数据库 schema。

固定原因列表见 `PreviewBuildReason`；兼容 validator 的 unsupported 使用 source-missing/model-spec-invalid/visualization-invalid/dependency-unsupported/python-unsupported/profile-unavailable/source-too-large，存储失败使用 storage-unavailable/object-conflict，历史源不可用使用 source-unavailable。schema 不以字符串错误泄漏内部 bucket key。

## 3. R2 写入、引用保护与撤权

阶段 1 storage 由平台从 scope、packageIdentity 推导内部 key；客户端永不提交 key。使用 create-only 条件写入，不覆盖同 key。R2 与业务状态不是事务：先持久 intent/reference，生成确定字节，条件写，再 GET 对摘要与长度，最后保存 durable receipt 并 ready。写响应丢失时用原 key/identity GET；匹配可补收据，不匹配 object-conflict，缺对象才按同一身份有界重试，不能生成新对象名掩盖未知写入。

receipt 是平台记录，不进包字节，至少含授权 scope、revisionId、buildIdentity、packageIdentity、内部 object key、对象 sha256/byteLength、profile digest、verifiedAt。ready 指向 receipt，读取时继续核对其 scope、Revision 与摘要。R2 缺对象则降为可解释 unavailable/failed，不能跑 head 回退。

引用保护：building/ready 的意图和收据必须持有对应 Revision 的 files 引用；不得保护/暴露整个 Session。发布冻结版本、复制和实验分别增加自己的引用，取消构建或项目删除仅释放自己的引用。GC 先核对所有 durable 引用与保留期再删对象；删除顺序和 orphan reconciliation 阶段 2A/GC 接线验证。撤权立即阻断新的授权读取，已有授权历史引用不等于当前用户仍能读。此协议不承诺收回用户已下载的字节。

## 4. 只读打开与显式 Verify

平台拟提供授权 GET build view 与 GET package bytes：入参仅 project/revision/profile 或 packageIdentity，服务端解析自己的 receipt 并核查项目权限。独立 URL 仍须权限；它不是公开发布。GET/刷新/播放/参数恢复不能新建 Run、调用 LLM、启动 Project/Tools/Pi；构建只处理保存文件。API 名称/路由由阶段 2A 固定，schema 消费者不得假定未实现 route 已存在。

浏览器运行输入严格 `{parameters,seed}`；steps/horizon 是 Model Spec 普通参数，播放速度仅控制显示。seed 使用既有 uint32 范围 `0..4294967295`，拒绝超限、小数和改值截断。参数最终需由已保存 Model Spec 解析/补默认值；通用 schema 只限字段类型/数量/字节，不替代 Spec 校验。

显式可信 UI 用户操作 POST Verify 输入严格为 `{revisionId,packageIdentity,parameters,seed,intent:'experiment',idempotencyKey}`。服务端核查身份和历史 Revision，自己解析源、Spec 和输入，创建既有单次 Experiment/Run。请求不接收指标、快照、artifact、R2 key、runtime 自报结果或 Evidence 结论。重复点击、未知响应和刷新重试沿用原 idempotencyKey；同 key 换输入应 conflict。Worker 消息不能触发 Verify 用户动作。

旧包 Verify 仅执行该保存 Revision；源 unavailable 明确拒绝，绝不能静默使用最新 head。服务端生成自己的持久结果/产物/provenance。需要 Evidence 时用户显式进入既有研究组协议，至少一 baseline 与一 intervention；不得伪造第二配置，或自动把单次 Run 当研究结论。阶段 2A 对接实验版本仍包含既有 filesSha256/specSha256。

## 5. 文件所有权与门槛

0A / 1A 拥有 `services/browser-preview/contract.ts`、fixtures、validator/package/storage 与本文件。0B / 1B 独占 runtime 独立目录、执行/隔离文档和浏览器测试。阶段 2A 拥有 central actor 与全部持久接线；0A 不修改其文件。此 schema 测试进入现有 `tests/m3/*.test.ts` 正式匹配范围。

G0 冻结接口和执行 schema tests。G1A 的校验/打包/storage 单元协议已实现，尚未证明完整 G1：可信 runtime 资产闭包与真实两端执行由 B/C 交付。待 G2：收据/引用实际持久实现、GC、授权 route、saved 自动派生/重启/alarm 合并、历史 resolver、服务端 Verify。任何 fixture 通过均不作为 G1/G2/G4 完整签收。

## 6. G1A 实现接口与验证边界

`validateSavedPreview(source, archiveBytes, profileId, registry)` 校验调用方已授权解析的 `{projectId,revisionId,filesSha256}`，再次验证 canonical 文件 archive 摘要，再逐条从现有 bounded reader 抽取五路径。Spec/visual 各32 KiB、lock64 KiB、两 Python 各1 MiB；读取不包含 Session。摘要不符与错误身份是错误，兼容拒绝是稳定 `{status:'unsupported',reasonCode}`。兼容成功是 `{status:'compatible',value}`，本身不等于 ready。

`model/visualization.json` 严格格式为 `{schema:'riffology.visualization/v1',protocol:'riffology.visual/v0.1',renderer:'grid'|'lane',metricKeys:string[]}`，metrics 必须为保存 Spec 声明键的非空唯一子集，不接受 URL/JS。模型入口必须 `def run(config)`；server wrapper 必须与平台 canonical `services/run/model_run_adapter.py` 原字节完全匹配。`riffology.model-run/v1` 在平台注册绑定 SHA256 `fa7987095bbc29f2c6d87e9b0f815415f88c9079ad7070fb7fe8b91e7ebf0898`；不匹配返回 unsupported/python-unsupported，即使它导入了 model.run。自动 build 的 validator 直接执行此检查，不能只靠生成 inspector，避免 browser 跑模型而 Verify 偷换服务器指标。此约束不改变既有 server-only 模型能力。静态 token 策略拒绝未允许 imports、动态执行/安装/网络桥接、明显顶层执行等早期不兼容；它不是完整 Python AST/语法验证或安全证明。真实编译/执行仍由隔离 runtime 和 server 执行器承担。运行时的恶意 fixture 验收绕开早期拒绝，才能验证 CSP。

源 dependency lock 沿用 `{schemaVersion:1,packages:{...}}`。Queue packages 必须为空；Mesa 源锁固定六个根：mesa3.5.1、networkx3.6.1、numpy2.4.6、pandas3.0.2、scipy1.18.0、tqdm4.67.3。`runtime.dependencies` 是包括平台预加载负向测试包在内的完整 browser distribution 闭包，不等于这六个源锁键。CPython 镜像也必须审核/固定其实际完整闭包，不自动追随 transitive latest。

`createTrustedPreviewRegistry(entries)` 接受平台 composition root 已审核的 runtime、`packages`、`assets:[{path,sha256,byteLength}]` 与 trust。资产清单按路径 ASCII 排序摘要必须精确等于 assetSha256，完整依赖摘要必须在资产清单中，limits/固定 runtime/Python/adapter 与源锁精确匹配。包 JSON 不能创建/替换 registry。默认 `emptyPreviewRegistry` 拒绝所有 profile；真实 runtime 资产清单接口由 B 提供后接线。trust='test-fixture' 只能明确 fixture 模式，不自动进入生产。

`packageCompatiblePreview(value)` 产出 `{manifest,bytes,sha256,trust}`。字节是 UTF-8 规范 JSON envelope `{manifest,files:[{path,base64}]}`，五文件顺序固定；每条 base64 还原原字节，所有摘要/长度重新核对。无生成日期、压缩元数据或 Session。`unpackPreviewPackage(bytes)` 拒绝非规范 envelope、错身份、错原字节、非规范 base64 及超限包。平台 runtime loader 必须执行等价校验，并按可信 registry 解释 manifest。

`storePreviewPackage(bucket, receipts, scope, packageValue)` 为每次调用先 await `receipts.begin(intent)`（实现者必须 durable 地记录意图并保护 saved-files 引用）；内部 key 从 `{tenantId,projectId,workspaceId}` 与 packageIdentity 派生。先 GET 恢复已有写入，缺失时 `put(...,{onlyIf:{etagDoesNotMatch:'*'}})`，即使应答丢失仍只 GET 同 key；校验摘要/长度后 await `receipts.persist(receipt)`，后者返回实际持久收据。persist 对相同输入忽略候选 verifiedAt 并返回首次持久日期，对其他字段冲突拒绝。对象写后持久失败保留对象，原身份重试补收据且不覆盖对象。此层调用 bounded single-attempt，重试/取消/backoff 由 G2 durable scheduler 管理。

`readPreviewPackage(bucket, authorizedScope, serverResolvedReceipt)` 再核对 scope/key/identity/Revision/profile digest/对象摘要，不直接授权用户；当前权限校验由调用方 G2 API 提供。它不会回退 latest head。默认 store/read 拒绝 test-fixture；tests 显式 allowTestFixture 且收据保留 fixture 标记，不能被生产 ready 消费。`PreviewReceiptPort` 目前是待 G2 实现的持久接口；单元测试假 port 不证明数据库/R2整链。

本地验证：`node --test tests/m3/browser-preview-build.test.ts tests/m3/browser-preview-contract.test.ts`、`npm run typecheck`。测试覆盖两 profile 合成包、确定身份/字节、原文件摘要/路径、unsupported 原因、篡改资产/包、引用建立失败、create-only 写应答丢失、收据失败恢复、跨 scope/旧源读取拒绝与 fixture 不进入生产收据。真实 Pyodide/CPython、真正 R2 与实际 durable receipt/GC/API 尚未由这些测试覆盖。
