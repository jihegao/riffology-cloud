# 开发执行状态

## 2026-09-07 私有 ServiceRuntime 接线与 SDK 传输修正（本地候选）

已连接 `ServiceRuntime` DO、TenantQuota、RevisionStore 和原生适配器。启动前验证完整 actor 身份、固定镜像及有效 dispatched 租约；supervisor 的持久启动/停止标记在重启后继续生效。关闭新建门禁不阻止观察和停止。新增纯 Workspace 归档接口 `serviceFiles`，避免误把 `load` 返回的 Pi Session 传入服务容器。

主控检查锁定 SDK 0.12.9 的实际实现发现 exec 不转发 stdin，原有 Docker 替身支持该字段会掩盖接口差异。已改为先写 root 私有分块文件，再由固定命令重定向读取；SDK 接口不再声明 stdin，失败的文件写入不会继续上传或启动。子 agent 完成真实 Workerd 测试，主控复核输入边界并重跑原生容器与完整检查。

[完整回归](evidence/runs/m0-local-20260907152330177/local-checks.json)通过且源码稳定：M0 **350 pass / 1 skip**、M1 **180 pass**、M2 **354 pass**、M3 **55 pass**，合计 **939 pass**。Workerd 验证真实 Runtime/Quota/RevisionStore 的租约、actor、scope 和镜像拒绝，上传归档摘要一致且不含 Pi Session，重启不重复启动，提前停止阻止启动，以及关闭门禁后仍能清理。Sandbox 在此测试中为 RPC 替身。

[修正后 Docker 验收](evidence/runs/m3-native-service-20260907152331340/native-service.json)通过且与回归具有同一源码摘要。716,800 字节分块归档成功恢复；真实 HTTP 验证 UID 10001、输入只读、控制目录与环境隔离。启动计数为 1，两个项目进程停止后为零，迟到启动被拒绝；部分块恢复与停止先于上传也通过，测试容器已清理。它仍不是实际 Cloudflare Sandbox SDK 纵向链路或云验收。

下一步继续实际 Sandbox SDK 本地纵向验证和部署配置预检，再连接 Workspace 权威版本、产品 API、Preview 网关与 UI。最大归档内存和总输出配额仍需验收。本轮无云部署、迁移、发布或模型调用，M3 和整体目标保持进行中。详见 [契约](m3-service-run-contract.md)与 [执行计划](m3-execution-plan.md)。文档在检查后更新。

## 2026-09-07 service Run 持久调度（本地候选）

新增 `ServiceRunHost` 与私有 `ServiceRun` DO。任务与首次 alarm 原子保存，再补建固定 Run ID 的 journal；actor 地址和完整不可变任务均校验。每次 alarm 先预置重试，stop 只写停止意图，不等待外部启动。终态但配额未释放继续对账；截止时间后的租约查询必须成功且确认不存在，才写 `acquisitionClosed`，查询超时不能据此清除 alarm。

真实 Workerd 发现 RPC 返回值附带 `Symbol.dispose`，此前被核心封闭 schema 拒绝。已在 Runtime RPC 适配层仅处理这一已知传输字段并释放结果，保持核心协议严格校验。子 agent 独立审查指出了未确认租约时提前清闹钟的风险，主控补齐状态与恢复测试。

[完整回归](evidence/runs/m0-local-20260907151056601/local-checks.json)通过且源码稳定：M0 **350 pass / 1 skip**、M1 **180 pass**、M2 **354 pass**、M3 **53 pass**，合计 **937 pass**。真实 Workerd 验证关闭门禁和错误 actor 无写入、不可变任务冲突拒绝、运行后重启、自动到期停止及释放后清 alarm；还覆盖 task/alarm 已保存而 journal 创建失败，重启后恢复取消且零配额占用。协调器另验证 lookup 超时保留未确认租约，以及成功确认不存在后的收尾。

Workerd Runtime 为测试替身，本轮未复跑原生容器或调用模型。实际 Sandbox Runtime DO、生产 bindings、Workspace/Gateway/API、Preview 网关与 UI 仍待接线；新建 gate 默认关闭，未部署或迁移云资源，整体目标继续。见 [宿主契约](m3-service-run-contract.md)。文档在检查后更新。

## 2026-09-07 原生 Python service 验证（本地候选）

已实现 `SandboxServiceNativeBackend`、分块归档上传程序与 root 服务启动器。适配器先核对平台镜像、保存版本及输入摘要，再传输；容器再次验证归档与入口/依赖/声明，恢复只读输入，以 UID 10001、清空环境和补充组、NoNewPrivs 及资源上限启动 Python。依赖锁当前支持空包或固定 SimPy 4.1.1，运行时无联网安装。停止使用永久 seal 与整个项目 UID 进程域清除，停止可先于上传或启动。

[真实 Docker 验收](evidence/runs/m3-native-service-20260907145738276/native-service.json)通过且源码稳定：实际 HTTP 返回 UID 10001、只读输入、控制目录拒绝、测试凭据未继承和 NoNewPrivs=1；重复启动计数为 1。服务及独立 session 派生进程共两项，停止后活跃项目进程为零；迟到 start 被停止标记拒绝，重复停止回执稳定。716,800 字节归档在首块确认丢失并只留下 128 字节后，直接适配器重放恢复成功且仍只启动一次。错误镜像拒绝。测试容器禁用网络并已全部清理；不是 Cloudflare Sandbox 传输或云隔离证据。

[完整回归](evidence/runs/m0-local-20260907145738314/local-checks.json)通过且源码稳定：M0 **350 pass / 1 skip**、M1 **180 pass**、M2 **354 pass**、M3 **50 pass**，合计 **934 pass**。[先前失败验收](evidence/runs/m3-native-service-20260907145603614/native-service.json)保留：原生检查已完成，脚本末项把同步镜像拒绝误写为异步断言；修正断言后按新运行目录重新验收。

主控负责 SDK 形状适配、分块传输、真实 Docker 与回归，子 agent 实现 Python wrapper 并补强 NoNewPrivs 与安装版本核验。当前尚未连接生产 Workspace/Sandbox 路由、自动到期 alarm、输出总配额、Preview 网关或 Browser UI；直接适配器重放不等于产品自动恢复已接通。本轮无云部署、发布、迁移或模型调用，M3 和整体目标继续。详见 [运行契约](m3-service-run-contract.md)。文档引用在检查后更新。

## 2026-09-07 service Run 协调与永久停止标记（本地候选）

私有 `ServiceRunCoordinator` 已连接 journal、TenantQuota 和 runtime 端口。固定租约请求与 runtime 身份后，依次取得 journal 一次性许可与 Quota dispatch；确认丢失按原操作查询或观察，不另建实例。停止或到期时，只有带永久停止标记、匹配作用域/租约且时间有效的回执才能请求释放。配额释放确认丢失可按同一回执恢复。到期停止记录明确 `service-deadline`。

`SqlServiceRuntimeSupervisor` 固定完整运行输入，持久保存单次启动尝试和不可逆停止标记；停止不等待挂起 start，且缺少进程不能被解释为确认停止。原生后端必须另行证明延迟启动被阻止、全部子进程已停止，目前仍为待实现端口。主控完成协调器与集成测试，子 agent 完成 supervisor 和独立审查；审查发现并修复端口输入可变引用、过早停止证明被永久缓存两处问题，另修复租约字段顺序导致合法回执误拒绝。

[完整回归](evidence/runs/m0-local-20260907144158690/local-checks.json)通过且源码稳定：M0 **350 pass / 1 skip**、M1 **180 pass**、M2 **354 pass**、M3 **46 pass**，合计 **930 pass**。新增 11 项协调测试使用真实落盘 SQLite journal/Quota 加 supervisor 和原生端口 fixture；12 项 supervisor 测试覆盖停止先于启动、挂起/迟到启动、确认丢失、SQL 回滚与输入篡改。独立审查另以 SQLite 复核过早证明拒绝后可恢复释放。文档在检查后更新。

生产 Workspace 路由、实际原生服务后端、自动唤醒、Preview 网关、Browser UI 与云验收尚未完成；未启动 OS 服务，不能把 fixture 当作实际 Preview。下一步实现原生文件恢复、受限执行、健康探测和子进程停止，再做生产接线。本轮无云部署、迁移或模型调用，M3 和整体目标保持进行中。见 [Service Run 契约](m3-service-run-contract.md)。

## 2026-09-07 独立 service Run 与共享配额基础（本地候选）

新增私有 `SqlServiceRunJournal`：固定保存版本计划、镜像 digest、时限与发起人；启动引用在事务中持久化后才返回一次性 dispatch 许可。重放、重开与持久化确认丢失不再次授予许可；停止请求阻止迟到的健康回报。独立审查以 SQLite 复现并修复停机 proof 的异步可变引用和启动前观察被接受两处问题，增加针对性测试。

TenantQuota 新增带明确 runId 的 `service-run`，与同 Workspace 的 runtime 共用租户容量，但保留独立 generation 与占额约束。旧 SQLite 结构事务升级并保留租约、操作意图和停止确认；未知或过期运行继续占额，旧确认不能释放替代实例。现有 Workspace runtime 的 operation 校验仍拒绝 service 租约。主控负责 Run journal、Workerd 集成与质量复核，子 agent 完成 quota 与独立审查，低成本子 agent 编写契约说明。

[完整回归](evidence/runs/m0-local-20260907142957703/local-checks.json)通过且源码稳定：M0 **350 pass / 1 skip**、M1 **180 pass**、M2 **354 pass**、M3 **23 pass**，合计 **907 pass**。真实 Workerd 验证 journal 与 quota 在重启后的重放、停止和占额边界；实际 SQLite 覆盖事务故障回滚、确认丢失、旧 schema 迁移及并发最后名额竞争。文档在检查后更新。

这两项是待接线的平台基础。生产 Workspace、Run/Quota 协调器、runtime 不可逆停止标记、实际容器健康与停止、网关和 UI 尚未接通；不能以 journal 的 starting/running 状态声明真实进程或 Preview 已运行。本轮无部署、迁移或模型调用，M3 与整体目标继续进行。详见 [运行契约](m3-service-run-contract.md)与 [M3 执行计划](m3-execution-plan.md)。

## 2026-09-07 Preview 保存版本解析（本地候选）

Preview 项目声明冻结为 `app/preview.json`；`.riffology` 继续保留给平台控制数据。声明采用封闭 schema，只接受受限 Python 入口、依赖锁、固定端口和本地健康/观察路径，不接受命令、环境变量、外部地址或权限字段。平台从已保存 Revision 的规范归档读取声明、入口与依赖锁，并保存三者的 SHA-256；整包摘要与收据不一致、缺文件或超限均拒绝。归档解析保留单份不可变快照，返回内容切片不能修改内部状态。

私有 RevisionStore RPC 已接入解析器；真实 Workerd/R2 测试覆盖保存后解析、入口和锁摘要、错误 actor、跨租户请求及无效归档拒绝。类型检查和[完整回归](evidence/runs/m0-local-20260907141820176/local-checks.json)通过且源码稳定：M0 **350 pass / 1 skip**、M1 **180 pass**、M2 **354 pass**、M3 **9 pass**，合计 **893 pass**。文档引用在检查后更新。

当前返回的是 service 执行计划，不是正在运行的 Preview。没有安装依赖、创建 service Run、启动容器、开放网关或授予 Observer 能力；JSON 中的 observation 也不证明接口只读。独立 service Run、配额、运行镜像冻结、启停对账、鉴权网关与用户端仍待实现，见 [M3 执行计划](m3-execution-plan.md)。本轮无云部署、迁移或模型调用；M3/G3 与整体目标保持未完成。

## 2026-09-07 管理端规范包上传（本地候选）

草稿行已提供“上传规范包”入口，浏览器校验 8 MiB 上限和草稿摘要后发送原始文件。服务端独立限制流式 body、核验规范包与摘要，并以 R2 条件创建写入固定 `model-content/` key；已存在的不同内容不能覆盖。写入响应丢失以回读验证恢复，数据库接受结果与上传审计使用持久幂等 intent。上传后模型仍为 draft，验证与发布继续由上节内容门禁控制。

operator 和冻结草稿来源分别在读取 body 前、写 R2 前、写入接受结果时检查。R2 与 D1 不构成跨服务原子事务，写入期间撤权可能留下已验证的不可变对象，但不会产生成功审计或状态升级；重试可以确认既有匹配对象。浏览器失败后重选同文件复用 UUID 请求编号，超限或摘要不符不发请求。主控复核修正了前端初版编号包含非法字符的问题，并加入 Gateway 合法编号格式断言。

[完整检查](evidence/runs/m0-local-20260907140333486/local-checks.json)通过且源码稳定：M0 **350 pass / 1 skip**、M1 **180 pass**、M2 **354 pass**。真实本地 Gateway/D1/R2 覆盖错误摘要无写入、正确上传与原始字节回读、同键回放单条审计、验证和发布；Chrome 覆盖文件选择、网络失败后的同文件重试、超限和摘要错误。主控负责 API/body 与集成验证，两个子 agent 分别完成存储和目录事务，低成本子 agent 完成界面与浏览器测试。此段是检查后的文档引用更新。

本轮无部署、云迁移或模型调用。官方模型的本地“草稿 → 上传 → 验证 → 发布”已接通；真实云验证与后续 Preview/Run 等计划项仍待完成，整体目标保持进行中。操作说明见 [模型发布运行说明](m1-local-runbook.md)。


## 2026-09-07 官方模型发布内容门禁（本地候选）

管理端验证/发布已接入实际 `MODEL_CONTENT` 读取与规范包验证。验证成功时在同一事务写 validated 状态、不可变内容收据、操作 intent 和审计；发布前必须重读原始包并与保存收据完全匹配。缺包、损坏、来源或收据不匹配，以及未配置验证器均拒绝。SQL 在存储读取后再次校验 operator 权限及冻结来源；成功请求同键回放无需重读包，不重复审计。撤回不依赖内容存储。新增 `0007_model_content_checks.sql`，验证后的内容引用不可修改。

主控完成生产 Gateway 接线、真实 Workerd D1/R2 测试和迁移清单核对；子 agent 完成模型事务与收据测试，低成本子 agent 完成管理端文案和 Chrome 失败重试回归。真实 Gateway 测试覆盖“缺包验证拒绝 → 上传原包验证成功 → 删除原包发布拒绝 → 恢复原包发布成功”，且收据恰好一条。校验仅证明格式、内容摘要和归档兼容性，不证明模型运行效果或安全审查完成。

[最新完整检查](evidence/runs/m0-local-20260907135431744/local-checks.json)：M0 **350 pass / 1 skip**、M1 **160 pass**、M2 **354 pass**，零失败且源码稳定。前次 [失败记录](evidence/runs/m0-local-20260907135255703/local-checks.json)保留：旧 provisioning 测试未提供实际模型验证器，被新门禁拒绝；该测试已改用真实规范包并通过。此段为检查完成后的文档引用更新。

上传仍由运维处理，管理页面没有上传功能；云迁移、MODEL_CONTENT 配置与发布尚未执行，本轮无云部署和模型调用。后续需完成受控上传/发布操作链路和云验收，整体计划与 M1/G1、M2/G2 保持未完成。操作顺序见 [模型发布运行说明](m1-local-runbook.md)。


## 2026-09-07 初始 Workspace → Turn 本地验收

初始引用已接入 WorkspaceAgent、TurnJournal、Runtime 恢复和 RevisionStore。首轮前 Files 显示平台 README、公共目录和官方模型文件；首轮把独立初始引用冻结进基线，不伪造已完成 Turn；首次 Diff 对照初始档案，后续回合优先使用已保存版本。初始来源仅由 confirmed-ready 服务端状态选定，checkpoint 和模型包分别从各自 R2 binding 读取。官方包和归档共用路径、条目及容量约束。

[完整检查](evidence/runs/m0-local-20260907134503067/local-checks.json)：M0 **350 pass / 1 skip**、M1 **154 pass**、M2 **354 pass**，零失败，检查期间源码稳定。[真实本地官方模型 CRUD 验收](evidence/runs/m2-product-turn-crud-fixture-20260907134503445/primary-review.json)：经真实 Gateway/D1/DO/R2、Project/Trusted Pi 容器完成 20 次写入/编辑/重命名/删除；最终保留 README 与两份官方原始文件，新增四份文件，首次 Diff 为 added=4；销毁两类容器后新实例恢复，归档 SHA-256 保持一致，恢复回合 Diff 为零。七类 Runtime 身份篡改、跨租户请求和损坏保存基线均拒绝。模型响应使用本地确定性 fixture，实际 Pi SDK、工具和文件链路运行；外部模型请求与模型预算计数均为零，不能据此声明真实 provider 或云隔离验收。

确定的初始对象缺失/损坏现在产生持久化 `turn-initial-base-unavailable`，不会一直排队。Workerd 覆盖失败状态跨重启与同键重放、零 Runtime 调用、恢复对象后新回合执行；网络暂时异常继续重试。公开提交/重放/取消响应及快照过滤内部初始引用。主控负责接线、故障复核与完整验收，三个子 agent 分别完成 Journal、恢复、Revision/Diff 及交叉审查。

本段为检查完成后的文档引用更新，不属于同次源码快照。本轮无部署、无模型调用，`cloudGatePassed=false`。管理端实际内容包验证收据、云部署验收，以及计划内后续模块仍未完成；M2/G2 不因本地链路通过而关闭。详见 [M2 初始基线计划](m2-execution-plan.md)。

### 先前阶段记录

更新：2026-09-07 11:27 UTC。**M0 的 G0 技术门禁 10/10 通过，共同候选已签收；M1 首个真实身份、个人空间、operator 管理端与首个项目已通过，官方模型内容完成真实本地 Container 链路，G1 尚未通过；M2 已通过 provider 关闭条件下的真实双 Turn、容器销毁恢复、跨租户拒绝、排队取消恢复、accept/cancel 响应丢失恢复、损坏基线拒绝、已保存 Revision 的 Files / Diff、受限 Project Bash，以及大结果 Artifact、引用权威、本地分页和工具卡读取入口；产品发布门禁仍默认关闭。** [主控签收](evidence/runs/m0-g0-accepted-20260906/progress.json)核对全部十项记录和 141 个证据引用，冻结 187 个源文件；本轮[不可覆盖完整检查](evidence/runs/m0-local-20260907110116681/local-checks.json)为 M0 349 pass / 1 skip、M1 146 pass、M2 300 pass / 0 fail，388 个源文件在检查期间保持一致，源码摘要 `136f2e83be4855eab33127c55af254e1f56eefaddcca1b8c13abe4b8b8e372e5`。检查 JSON SHA-256 为 `defc9dfc57981c0055b7f54c950dc67d7361e9e2e19cddbc54292001976505fc`，日志 SHA-256 为 `91674158c36f5029cb402a40ca880240bba528d897a34c33fbf1cb273fbf79de`。`cloudGatePassed=false` 表示本次没有把本地检查扩展成新的云发布门禁。前一记录 `m0-local-20260907105958681` 遇到既有 M0 并发进程用例的单次时序失败；该用例隔离重跑通过，随后同一源码的完整记录通过，失败记录原样保留。工作分支 `codex/m0-runtime-foundation`，修改未提交、未推送，仓库没有远端。

最新[真实产品 Turn 本地证据](evidence/runs/m2-product-turn-provider-disabled-20260907053121020/primary-review.json)使用当前产品 release assembly、真实 ProjectRuntime、Project Tool Sandbox、Trusted Pi Sandbox、D1/DO/R2 和库会话 fixture，完成项目初始化及两个连续 Turn。首轮运行时又创建两个排队 Turn 并在派发前取消；Workerd 重启后它们仍保持 cancelled，且没有 checkpoint。首轮在 provider 关闭时记录 503 并保存失败终态；随后强制删除首轮 Project 与 Trusted Pi 容器，以首轮同一不可变 receipt 同时恢复 workspace 与 Pi Session 到两个新 actor。第二轮文件哈希保持一致、Session 哈希推进，再次保存失败终态。随后删除第二轮 Session blob并再次销毁容器；第三轮在分配 Sandbox 前终止为 `turn-base-unavailable`，持久化明确为 `turn-checkpoint-unknown`，未创建第三个 manifest 或新 Sandbox。第二租户对 workspace snapshot/session/events、tenant projects 和 cancel 的五次访问均在 Runtime 前返回 404；内部 Runtime 对 tenant、project、workspace、generation、session、turn 和 dispatch 七个身份字段的逐项篡改均返回 409，拒绝过程未改变 R2 对象或容器集合。三轮在 Workerd 重启后终态一致。两轮可执行路径的模型预算各为 `attempts=0`、`dispatchedCalls=0`，外部 Worker fetch 为 0，容器全部清理。回执 SHA-256 为 `3b077263a36f5753cf54fec1f06101a0ff968ef4b6f0a10afada952231c5229c`。验收只在生成的 `m2-provider-disabled-v1` 镜像中启用候选 release；产品 Dockerfile 仍加载失败关闭 release，产品配置与 staging 的 Turn/provider 开关仍为 `false`，没有模型调用、云部署或容器滚动。[完整产品拓扑证据](evidence/runs/m2-product-topology-v2-local-20260907/primary-review.json)继续证明八个 DO、R2、两个私有服务和三类镜像可启动，且不依赖 `m0-*` 或 `Dockerfile.local`。浏览器已确认个人空间激活完成并进入项目列表。

[T10 发布与回退](m0-release-cloud-validation.md)已补齐真实 native monitor 退出码 42，以及原回退 W1/I1 的新实例从 R2 恢复 2、写入并回读 3。原保存点未变，新保存点独立下载核对；两个应用七条实例记录均 inactive。独立审查和正式门禁记录均完成，旧失败及未知观测保留。

[旧系统退役](m0-legacy-retirement.md)在 10:16 UTC 再次确认：`riffology-demo` Worker、旧根路由和两条 Tunnel CNAME 不存在。没有兼容入口。本地 UI 4173 返回 200。

T01 的两次 Go 调用已完成并撤权；本轮新增模型派发为 0，不补发第三次。预算仍为 US$5、模型最多 US$1，现金扣款待对账。G0 仅签收技术可行性；真实云登录与项目验收、持久回合、Browser 产品接线、Run、管理端及付费链路尚未交付。后续顺序见 [M1 执行清单](m1-execution-plan.md)。

## M1 当前实现

Trusted Pi 取消已补齐 SIGTERM 排空语义：信号发出后若同一进程仍运行，Runtime 保持非终态并只继续观察；只有后续观察到进程退出和匹配的 cancelled terminal 才生成停止证明，不会重复发送 kill 或提前释放队列。

Project Bash 已从 Trusted Pi 的工具定义接通到 Project Sandbox 固定 wrapper。平台只发送已校验的脚本与 30 秒以内超时；wrapper 读取 root-only 控制文件后降至 uid 10001，再以无 profile、固定环境和 `/workspace` cwd 启动 Bash。stdout/stderr 各保留 6000 字节并明确标记截断；超时杀死整个进程组，因超时前可能已有文件副作用，Tool Ledger 保持 `unknown` 且不自动重放。[真实 `linux/amd64` 本地镜像证据](evidence/runs/m2-project-bash-local-20260907072338/bash-local.json)验证 Bash 与产物 owner 均为 uid 10001，回执 SHA-256 为 `b7107d439918adf08e586b6861812805050cc9ea0a1513f53e7809dfe1e49a00`。云容器中的取消、资源上限和停止证明仍须单独验收。

官方模型库已完成本地元数据纵切、内容来源冻结、受控包构建、私有 resolver 与真实 Container 安装候选：第 6 个 D1 迁移定义固定版本、`draft → validated → published → withdrawn` 单调状态、发布后内容不可变、持久幂等 operator intent、独立追加审计和 Project 来源约束；Gateway 提供公开 published 列表/详情、operator 全状态列表与生命周期操作。`m1:model-package` 从受限目录生成唯一规范 JSON，拒绝符号链接、硬链接、特殊文件、非 NFC/越界路径、超限文件和覆盖输出，并只打印包级摘要。项目创建把固定版本与内容摘要冻结到 Outbox；ProjectRuntime 只从私有 `model-content/` namespace 解析最多 8 MiB 的包，重算包和逐文件 SHA-256，通过固定 Node 程序的有界 `stdin` 安装。安装意图、receipt 和 manifest 先进入 SQLite；完整安装但响应丢失时只读回文件，半安装只用同一冻结引用幂等补齐，到期、撤权或停止后不再安装，容器启动始终最多一次。已有目标测试覆盖非规范 JSON、硬链接和恢复窗口。[官方模型内容真实本地链路](evidence/runs/m1-workspace-20260907063137662/workspace-local.json)进一步经 Gateway、D1、WorkspaceAgent、TenantQuota、私有 R2 与原生 Docker 安装 392-byte/2-file 包，逐文件确认后生成绑定模型来源的 checkpoint，停止并释放配额，Catalog 最终投影 `ready`；源码前后摘要一致，回执 SHA-256 为 `7f5b6fe09f9da8ac2331cfa8c9ad12d349fd52f9d4fe1a1926abfac7af1a499c`。生产用户端与管理端仍只管理目录元数据；云 `MODEL_CONTENT` bucket/binding、operator 上传发布、迁移和双身份隔离尚未完成，因此不能称为模型库上线。

M2 Revision 的生产候选路径已改为私有 `RevisionStore` Durable Object：ProductTurnRuntime 只冻结 Project/Pi 字节并调用 RPC，release assembly 不再持有原始 R2 reader/writer；同一 Revision bucket 的 commit、observe、restore、load 和 GC 统一经过一个对象。写入或 GC 在首次 R2 await 前保存 operation fence，实时请求用对象内串行链覆盖 await 交错，DO 重建会把遗留 reserved 转成 unknown；不使用跨 R2 await 的 `blockConcurrencyWhile`。ProductTurnRuntime schema v2 在 commit 前持久化完整 descriptor，响应丢失或重启后只允许精确 reconcile。GC 本地候选现持久保存 `scan_manifests → scan_blobs → delete_candidates → completed` 阶段、分页游标、引用集、候选集、删除中的 key 和统计，并用 `operationId + inputSha256` 精确对账；只删除超过最小年龄、未被有效 manifest 引用且匹配规范内容寻址前缀的 blob，状态或 R2 读取不确定时失败关闭。完成态不阻断 observe/restore/load，下一次 mutation 才清理临时行。本地 Workerd 进一步注入“R2 delete 已生效但响应丢失”，首次 GC 进入 unknown，精确 reconcile 观察对象已不存在后只推进原候选和计数，重复 reconcile 返回同一完成结果，Revision 读取仍可用。线上调度及云 R2 大桶验证仍未完成，因此不能安排线上 GC，Turn 门禁保持关闭。

M2 大结果 Artifact 已形成独立平台候选。Project Sandbox 的 read/list/search 仍只负责产生有界 UTF-8 JSON；超过 16 KiB 的结果由 Tool Bridge 交给固定 `ToolArtifactStore`，该 SQLite DO 持久化完整 effect identity 和 operation fence，再以不可覆盖写入及回读摘要确认 `tool-artifacts/` 前缀下的对象。Ledger、Pi 和浏览器都只得到不含对象 key 的 receipt。WorkspaceAgent 复核 scope 和自身 actor，Gateway 先按 Catalog 当前成员关系与 ready Workspace 做所有权检查，再提供只读 JSON API；关闭新 Turn 的 `M2_TURNS_ENABLED=false` 不会阻断已保存 Files、Diff 或 Artifact。新增 `project_read_page` 以 UTF-8 字节 offset、8 KiB 单页上限和首段 SHA 锁定同一文件版本；20,000 字节文件在真实本地 Workerd + Project Sandbox 中以 3 页完整返回，同时生成 20,146 字节 Artifact，重复同一命令保持一个 R2 对象。Trusted Pi host 只提取严格 receipt，Runtime 二次校验后投影到 `tool.completed`，用户端工具卡以当前 Workspace 和合法 artifact ID 生成只读链接，伪造 ID、HTML media type 与失败工具均不生成链接。[分页、Artifact 与 UI 本地证据](evidence/runs/m2-read-page-artifact-ui-local-20260907/primary-review.json)保留原分页与 UI 纵向链路。

ArtifactStore 现在同时是唯一引用权威：新对象与 `tool_effect` 引用在同一 SQLite 事务出生；升级时严格解析旧 artifact identity 并幂等回填该引用；`tool.completed` 事件必须先完成 scope、Turn、dispatch、artifact ID 一致的 `turn_event` retain，才允许进入 Workspace journal。retain/release 重放幂等，已释放引用不能重新激活，跨租户或 generation 请求在对象读取和引用变更前拒绝。先 retain 后 journal append 的失败窗口只会造成保守保留，不会误删；WorkspaceAgent 已提供受 ready scope 保护的私有事件引用释放接口；只有 Turn 终止且事件及幂等回执均不再保留时才可释放。尚未接自动调度、工具效果引用释放，也没有 Artifact 删除或 GC 实现。[Artifact 引用权威本地证据](evidence/runs/m2-artifact-reference-local-20260907112445838/primary-review.json)记录旧行持久化升级和只读审查无本切片 P1；[生产 Workspace 装配证据](evidence/runs/m2-artifact-reference-wiring-local-20260907113144206/primary-review.json)进一步记录组合定向 25/25、M2 304/304、TypeScript 通过、真实 `tool.completed` 双引用、Workspace 读取和跨租户拒绝；第一次完整运行在既有模型预算并发测试中因两次动态 deadline 不同触发幂等冲突，[失败记录](evidence/runs/m2-artifact-reference-local-20260907112306283/primary-review.json)原样保留，测试随后改为复用同一不可变请求并完整通过。证据不代表 staging 或云 R2 已接线。下一工作包必须由 journal 终态/压缩与 Tool Ledger 的持久状态定义 release，再实现带 grace period、分阶段对账和严格前缀的 GC；在此之前继续禁止删除 `tool-artifacts/` 对象，代价是存储只增长。

TurnJournal 已升级 schema v3：Turn 自身保存本地 started/terminal sequence，workspace/session head 和请求 intent 不依赖事件数组；runtime event receipt 保存原事件并对活动 Turn 设置独立 4096 条上限。事件窗口同时限制 2048 条和 4 MiB，每次追加在同一事务内自动裁剪为合法尾部窗口；显式 compact 仍可缩小窗口。旧游标返回 `snapshotRequired`，SSE 在越过缺口前发送 `snapshot.required` 并关闭。v1/v2 状态在下一次写事务中迁移；裁剪后活动 Turn 的相同 runtime event 重放仍返回原 receipt，不创建重复事件。Turn 进入终态后不再接受 runtime append，因此同一事务会清理其 receipt，旧状态也会在 claim/compact 时回收，避免 workspace 生命周期累计触发上限；活动 Turn 达到 4096 条时仍失败关闭。长期事件审计归档仍未实现，但它不再是 runtime event 幂等性的前置条件。

WorkspaceAgent 的真实 Workerd 链路已补 `accept` 与运行中 `cancel` 的“终态已持久化、RPC 响应丢失”故障注入。调度器再次投递时只调用一次 `observe`，两个 Runtime effect 的调用计数都保持 1，原 Turn 分别恢复为 `completed` 与 `cancelled`，重复取消不再跨 Runtime。测试用具显式强制逻辑 alarm 到期，以验证持久 wake 的重投递语义而不依赖 Miniflare 对失败 alarm 的自动退避时序。pending provisioning 与活动 Turn 并存的产品级故障注入仍待完成。

M1 staging 已部署专用 D1/R2、Worker、三个声明式 Durable Object 和 Container application；[配置与预检](m1-staging-plan.md)为 20/20 passed。新入口 `m1.riff-demo.gaojihe.cn` 首页返回 200，未登录 `/api/me` 返回 401，不占用 M0 Preview 根域名；旧 `riffology-demo` Worker 与 DNS 入口均不存在。M2 已有 Tool SQLite 账本、一次性 effect dispatch、文件 effect envelope、SQLite Project effect supervisor、SDK Native adapter、双 Sandbox actor ID 和固定出站策略，以及用 `dir_fd + O_NOFOLLOW` 抵抗 symlink 和父目录替换竞争的文件适配器。本地项目镜像固定 Sandbox 0.12.9-python digest，root wrapper 读取 0700 控制目录后降至 uid 10001；[本地 Durable Tool Bridge 证据](evidence/runs/m2-tool-bridge-local-20260907/primary-review.json)确认 Workerd 通过真实 SQLite Ledger 授权、派生 Tool Bridge/Project actor、签发 capability、连续两次完成容器写入/读回并稳定回放。[Trusted Pi 内部 HTTP 证据](evidence/runs/m2-trusted-tool-http-local-20260907/primary-review.json)确认锁定 SDK 的 outbound `containerId`、HMAC 与三类 actor 绑定，错误 scope 在账本前返回 403。[共享 alarm 与 Turn engine 证据](evidence/runs/m2-shared-alarm-local-20260907/primary-review.json)确认 provisioning 与 Turn 共用一个物理 alarm 时仍保留各自 deadline，并发取消只有事务胜者调用一次 runtime。[产品 Turn Runtime core 证据](evidence/runs/m2-product-turn-runtime-local-20260907/primary-review.json)冻结独立 SQLite execution fence、完整 actor identity、observe-only 恢复、取消与 checkpoint 分栏。新增的[本地 Revision 证据](evidence/runs/m2-turn-revision-local-20260907/primary-review.json)验证内容寻址的文件/Pi Session blob、完整身份 manifest、R2 回读摘要、并发终态和 journal 两阶段对账；真实 Workerd 停止重启后 execution/freeze 仍各一次，收据与三个 R2 对象一致。R2 receipt 不是产品 `saved`，只有 Workspace TurnJournal 原子提交后才可报告保存成功。若首次 commit 与 observe 都无法确认，Runtime 保留一次性 materialization fence，Turn 继续处于 `checkpointing` 并由 alarm 观察同一 receipt；晚到收据可完成原 Turn，不能再次创建 Revision。确定损坏的基线仍直接失败并释放队列。

M2 新增的 Trusted Pi execution/native adapter、容器 turn host 与独立镜像候选把 `sessionId` 纳入 Runtime/Revision 全身份，并限制事件时间、数量与累计大小。Workspace TurnJournal schema v3 同时维护最新 workspace head、各 Session head、独立 start/terminal lineage 和有界事件窗口，在 claim 的同一事务中冻结两个不可变收据；Dispatcher、Product Runtime、Trusted Pi 与 Revision manifest 原样携带这组基线。恢复时 Session 字节必须匹配收据摘要，Revision 提交前必须回读基线 manifest 与两个内容 blob，并验证租户、项目、Workspace、generation 和 Session 归属。[本地基线版本链证据](evidence/runs/m2-turn-base-lineage-local-20260907/primary-review.json)关闭了“重试读取变化后的基线”和“父版本由项目侧自报”两个 P1，且覆盖旧 v1 本地状态的下一次写入迁移、head 回滚、伪造收据与跨 Session 拒绝。旧状态的迁移排序收紧为本地 journal terminal/start sequence，远端 `committedAt` 只作收据事实，不能倒置本地 head。host 的 control 不接受模型、prompt、skill、工具或凭据字段；这些只能由镜像内 release 模块提供。输出 Session 先于 terminal 结果持久化，且只有 supervisor 明确观察同一原生进程退出才产生停止证明；进程登记缺失保持 `unknown`。真实三容器验收修正了 Trusted Pi 镜像缺少 `pi-server`、Node 路径、符号链接入口、release 相对导入和非 2xx 响应观测五个装配缺陷，并确认失败终态仍保存项目与 Pi Session 摘要。[Workspace 归档与镜像证据](evidence/runs/m2-workspace-archive-local-20260907/primary-review.json)连续两次完成 Project Sandbox 空版本恢复、写入、规范 USTAR 冻结、源容器销毁、另一派生 actor 恢复与错误身份拒绝，归档摘要一致；R2 reader 同时增加实际字节和 files + Session 聚合上限。由于 `/workspace` 是独立挂载点，恢复器在挂载内完成临时树提取与重新冻结校验，再在 Pi 启动前安装目录项；失败不进入 Pi，保留输入供下次修复。[Workspace 与产品 Runtime 接线证据](evidence/runs/m2-workspace-runtime-wiring-local-20260907/primary-review.json)进一步验证了独立 `ProductTurnRuntime` SQLite DO、完整身份 actor、WorkspaceAgent 的 Turn engine、provisioning/Turn 共享 alarm 路由，以及真实 Workerd 中从 Session 入队到保存终态与事件回放的完整控制链。该链路还修正了跨 DO 时间语义：R2 物化时间可早于 Workspace 的 checkpointing 确认，终态和事件使用 Workspace 本地提交时间，避免回合卡死。[本地模型预算与代理门禁证据](evidence/runs/m2-model-budget-local-20260907/primary-review.json)新增 Tenant 范围的 SQLite Token/call authority、短期 Turn capability、Sandbox request MAC、实际容器 ID 校验与私有 `/v1/responses` gate；同一 Turn 的 Runtime 恢复不重置预算，派发响应丢失和 provider 不确定性只进入 observe/pending，调用方不能选择 model、provider 或凭据。[Workerd 预算证据](evidence/runs/m2-model-budget-workerd-local-20260907/primary-review.json)进一步确认跨 Tenant actor 拒绝、并发一次性派发、重启恢复、策略冲突与第二 Tenant 隔离。该 authority 不含价格、余额、支付或退款。[Turn admission 本地门禁证据](evidence/runs/m2-turn-admission-gate-local-20260907/primary-review.json)确认提交在解析 WorkspaceAgent 前返回 503，不会新增永久 `queued` 记录；开关只有精确字符串 `true` 才放行。该门禁已经以 `M2_TURNS_ENABLED=false` 部署为 staging Worker 版本 `beeb20f0-6346-405e-88ea-632ea87863d8`；[部署与线上只读证据](evidence/runs/m2-turn-admission-gate-staging-20260907/deployment.json)确认未构建或滚动 Container、主页 200、未登录 `/api/me` 401，以及激活记录为 1 个已接受邀请、1 个活跃用户、1 个活跃 Tenant 和 1 个有效成员关系。新增 ProductTurnRuntime、RevisionStore、TenantModelBudget、ModelProxyService、WorkspaceAgent 接线及其余 M2 Runtime/Revision/host 仍仅在本地，未部署。供应商凭据注入、真实付费模型回合、Artifact 云链路、云双 Sandbox 和真实登录 Pi Turn 仍未验收；本轮模型调用为 0。

2026-09-06：[最新完整检查](evidence/runs/m1-local-20260906134220998/local-checks.json)为 **M0 348 pass / 1 skip、M1 103 pass / 0 fail**，242 个源文件在检查期间保持一致，源码摘要 `72ef317d6cf3b92ef5cf8948ba9ec8c6d7f4daaf94090d55cabb03eb919f184f`。[首任 operator 本地证据](evidence/runs/m1-bootstrap-20260906134338/bootstrap-local.json)绑定第 5 个本地 D1 迁移、离线工具、事务故障和凭据边界；[管理端本地证据](evidence/runs/m1-admin-20260906130122/admin-local.json)绑定真实 Worker 静态响应与 Chrome 行为。[真实本地完整链路](evidence/runs/m1-workspace-20260906121130494/workspace-local.json)完成 Gateway → D1 outbox → WorkspaceAgent/alarm → TenantQuota → 原生 Docker → R2 → 原生停止 → 释放配额 → D1 ready。它们使用隔离数据库中的库会话 fixture，没有 Google、云、邮件或模型调用。

- Catalog/Admission：邀请、个人 Tenant、Membership、项目归属、幂等创建、追加审计；创建时固定原始 authVersion，持久 outbox 跨请求继续存在。每分钟私有扫描最多十项，与 DO 幂等接收共同覆盖“数据库已提交、派发前中断”。
- Gateway：Better Auth 1.7.3、数据库会话、撤权、同源写入、8 KiB / 5 秒请求体限制和固定认证入口。Google OAuth consent/callback、真实 Cookie、邀请准入和 operator 权限已在 staging 验证。写入成功后的首次 UI 读取曾短暂显示旧状态；远端 D1 read replication 已确认关闭，正在补客户端写入响应合并与恢复轮询。
- WorkspaceAgent：SQLite 状态和 watchdog alarm 原子保存。初始化、停止、dispatch 未知时只观察同一实例；配额申请和释放先 lookup，固定 payload 最多三次持久幂等尝试。晚到或撤权任务不能新启动实例，D1 恢复后可继续未确认投影。
- ProjectRuntime：固定空白目录与 nonce marker，读回真实文件后保存不可变 R2 checkpoint；先持久停止标记再原生 destroy。文件摘要、原生停止和配额释放全部确认才把项目投影为 ready；此时 VM 已停止，ready 指文件已准备并保存。
- 用户端：`services/web/` 接入真实 API，Google 登录入口、邀请准入、空白/官方固定版本项目创建、状态与退出。官方模型卡可直接打开并精确预选固定版本；目录支持刷新，撤回或加载失败会移除未提交的旧选项，首次请求失败后则锁定原选择、body 和 key，项目列表区分空白来源与官方独立副本。就绪项目可进入生产静态入口中的 Workspace，读取持久 Snapshot 与 Event，创建、切换 Session，提交或重试同一 Turn intent，并显示回合、provider、保存状态、合并后的 assistant delta/message 与折叠工具卡；合法大结果 receipt 会在对应工具卡显示当前 Workspace 下的“查看完整结果”链接，失败或伪造 receipt 不显示链接。页面固定展示平台与项目内 Pi 的职责边界。Workspace 右侧 Files / Diff 面板通过受所有权保护的 `GET /api/workspaces/{wid}/files` 和 `GET /api/workspaces/{wid}/diff` 读取最新已提交 workspace head。WorkspaceAgent 在私有 journal 内恢复完整 Runtime identity；RevisionStore 校验当前与父 Revision 收据，只在对象内部比较规范 USTAR 的类型、模式与文件字节。公开响应仅含 Revision 摘要及路径、变更类型、类型、大小和模式，不返回文件内容、R2 key、dispatch ID 或 Pi Session。无已保存 Turn 时显示真实空状态；Files 自动加载，Diff 只在选中页签时加载，手动刷新只请求当前页签。两条读路径均不受 `M2_TURNS_ENABLED=false` 影响，也不发起模型或容器写操作。可信项目 hash 只有在重新读取当前租户项目列表并匹配 ready Workspace 后才恢复，刷新后重新建立观察；无效或外来 hash 不请求 Workspace。真实 Chrome 验证目录失败时空白入口仍可用、目录变化后的固定版本精确重试、连续失败后同键重试、Session 切换、消息、工具与文件名只作文本、Files / Diff 安全文本渲染与定向刷新、Artifact 链接约束、取消表单、隐藏页面暂停、五分钟停止项目轮询、退出后忽略晚响应。Runs Panel、Browser 插件与事件归档仍待接真实 API。4173 的 `ui/` 工作台已删除机场图、文件、Diff、Run、成本和计时等伪运行数据，未连接时只显示禁用操作与明确空状态；其他项目页和管理页仍保留设计评审示例。本次改动仅在本地，未部署。
- 管理端：`/admin` 接入独立 operator 角色、平台摘要、租户状态计数、邀请创建/撤销和追加审计。模型管理 API 与生产静态页面已支持草稿创建、校验、发布、撤回和全状态列表，权限在 mutation SQL 内复核，只有实际状态变更写入独立 model 审计；网络失联按持久 intent 回放，不会重复创建或产生虚假成功审计。页面明确当前只管理元数据，内容包尚未上传或复制。普通 owner 统一拒绝；管理查询不持有 R2、Runtime 或项目内容绑定。邀请码明文只返回一次，D1 只存 hash；同键重试与丢失响应不会创建第二条邀请或再次泄露 token。真实 Chrome 已覆盖权限拒绝、精确重试、安全文本、模型状态流转、一次性 token、撤销和移动端布局。
- 首任 operator：新增无公开 HTTP 入口的离线引导脚本和第 5 个迁移。脚本只把 token hash 交给显式 local/remote D1，响应丢失按同一 hash 回读；已验证邮箱接受唯一 bootstrap 邀请时，在 Admission 同一事务授予角色并追加审计。普通邀请、第二个 bootstrap、既有 active operator、异 token/email 和每个注入失败点均拒绝或整体回滚。

**G1 尚未签收。** [首位运营账号与首个项目云证据](evidence/runs/m1-first-operator-cloud-20260907/acceptance.json)已确认正式 Google 登录、bootstrap 邀请接受、个人 Tenant、operator 管理端，以及首个项目从 D1 outbox 经原生 Container、R2 checkpoint、停止到 `ready` 投影；实例终态为 `inactive`。剩余：第二真实身份的并行与跨对象拒绝、同租户最后配额名额竞争、创建故障云对账。生产持久 Turn、可恢复的任意项目文件、Browser、Run、官方模型内容包和收费仍属后续阶段。本轮没有发送邮件、第三次模型调用、提交或推送；旧 `riffology-demo` 入口保持退役。

参见[初始化 ADR](adr/0003-m1-workspace-initialization.md)、[本地运行手册](m1-local-runbook.md)。以下保留 M0 历史结果，顶部 G0 签收只属于其冻结候选。

## 已交付的 M0 代码

| 模块 | 实际能力 | 证据边界 |
|---|---|---|
| 受控 Pi 宿主 | 显式资源、模型和远程工具清单；无项目扩展发现、全局凭据回退或本地 Shell 工具；Session 恢复重验归属与清单 | T03 恶意文件发现隔离和 T01 真实供应商调用/完整 Session 恢复均已云签收；生产工具接线属 M2 |
| 取消与终态 | 等待凭据或平台最终 payload 检查时可取消；晚完成/晚失败不会发请求；非协作工具超时关闭宿主，要求 supervisor 终止；显式 completed / aborted / failed | 本地竞态测试及云 DO 监督器通过；T01 的代理终态为 completed/cancelled，生产 durable Turn 属 M2 |
| 受限模型代理 | 固定请求/模型、原子预留、透明 SSE；SQLite DO 账本、两层 capability、取消 fence；新增独立 Go live profile，固定 run/两次调用/整窗预留 | 23 项 staging fixture 及真实两次 Go 云调用通过；独立账本回读与撤权通过；计费结算仍未知 |
| 保存协议与文件恢复 | 不可变内容和 Session 包、摘要校验、最后提交指针与事件、父版本及 generation 比较；保存收据、终态元数据在同一事务提交；真实文件 20 次 CRUD、销毁后重建与恢复后写入 | T05 云文件、T06 云 fault、T01 真实 Pi Session/R2 恢复均已签收；完整产品项目恢复属 M2/M5 |
| Sandbox 探针 | 独立可信/项目 Sandbox、固定操作、强 Bearer、合成租户 capability、出站观测和清理 | T02 云隔离、T04 资源矩阵、T09 HTTP 出口与固定依赖均已签收；DNS例外及 TCP 超时单列，生产身份属 M1 |
| Preview 探针 | 分离控制与 Preview hostname、短期 capability、固定 HTTP/WS 路由、凭据剥离、重定向过滤、真实 Chrome iframe 与撤权 | T07 云浏览器 15 case 已签收；主体为平台控制的测试身份，生产登录和跨站 Cookie 支持另行验收 |
| 中断与恢复探针 | DO alarm 独立推进真实 Pi，SSE 只观察；保存真实 Session 后 SDK kill / Sandbox 销毁，新实例从已确认上下文恢复，旧代事件与写入拒绝 | T08 三组云场景已签收；本地 SSE fixture，非真实供应商或生产 durable Turn；SIGKILL 是请求意图，具体 OS 信号未独立验证 |
| 发布策略探针 | 真实子进程握手、协议准入、任务版本固定、候选启动失败回退、已确认 checkpoint 恢复、未知副作用不重放 | G0-T10 已按固定探针范围签收；真实混合发布、原生退出取证及双回退恢复均有独立证据，生产发布流程属后续阶段 |
| 镜像与配置 | Pi / Sandbox / Wrangler 锁定；两种基础镜像固定 digest；可信镜像包含 Pi 宿主；独立 Worker 配置；staging 私有 R2 checkpoint bucket 已创建并与三个 `CHECKPOINTS` 绑定一致；Storage 与 fixture 模型代理 Worker/DO 已部署 | Boundary、Preview、Files、Recovery Worker / Container apps 及 Tenancy 已部署；历史 Registry 失败保留，其余云门禁继续 |
| 证据和流程 | 环境 preflight、完整源文件摘要、运行日志、不可覆盖的证据记录、失败阻断汇总及本地发布清单复验 | 清单始终 `canPromote=false`；本地记录只能作辅证，不直接关闭 G0 |

当前生产身份、真实云项目验收、持久回合、Browser 鉴权代理、仿真应用、Run、官方包和付费链路尚未交付。`ui/` 仍是独立示例原型。

## 历史验证记录

以下保留历次执行时的状态与失败记录；其中“最新”“未部署”“待验收”等表述属于当时状态，当前结论以上文与各单项最新签收文档为准。

- [受控 Pi 代理接线](m0-proxy-pi-bridge.md)已完成本地集成：完整 Session 首次/恢复历史、固定单次 capability、同 call 显式取消、响应头前后超时、错误/重定向无重试、跨片段凭据脱敏和原始图片 checkpoint 拒绝。客户端未部署，也未进入此前冻结镜像；云 Pi/真实供应商和完整工具协议仍待接入。
- [首次全检失败](evidence/runs/m0-local-20260905141740796/local-checks.json)发现 `message_start` 也可能携带已经更新的文本片段；修正为所有非终态事件保护累计文本后，强化的拆帧测试与最新全检通过。失败记录保留。

- [模型代理云端检查](evidence/runs/m0-model-proxy-cloud-1788613210899-49e0a3db/model-proxy-cloud.json)：23/23，50 次业务请求、50,210 响应字节、34.347 秒；4 个 run 均撤权且 active=0，真实供应商派发为 0。Worker [部署版本](evidence/runs/m0-model-proxy-staging-1788612744246/deployment-verified.json) `06e097f1-cb6d-4349-8cf5-af4472ba0079`，运行后 API 确认仍 100% 指向该版本，DO 使用 SQLite。该结果只签收 fixture 原语，不关闭 T01/T09。
- [替代镜像](m0-registry-alternative.md) trusted / project 已按当前 8 文件白名单上下文构建成功、冻结 manifest；尚未 push 或启动应用容器。2026-09-06 用户已批准[当前九文件镜像](m0-pi-proxy-image.md)的公开范围；`jihegao` CLI 设备授权已完成，见[环境确认](m0-setup-confirmation.md)。本条前述八文件产物为历史版本。

- 最新本地检查 [m0-local-20260905155634615](evidence/runs/m0-local-20260905155634615/local-checks.json)：192 项通过、1 项 opt-in Python 跳过、2 个自检通过；121 个源文件摘要稳定，源码摘要 `192d973b8caa5019c8fa10c6558ecab26b9d1486d8e0f8af9480f493f7ffba58`。保留原有 13 项真实 Pi → 本地 HTTP → 代理原语测试，并新增 3 项诊断 CLI/超时测试；下述 Workerd 联调保留前轮源码；本轮 staging 入口与镜像检查源码对应当前全检。
- [模型代理 Workerd 集成](evidence/runs/m0-model-proxy-local-1788611379474-ec85ee9b/model-proxy-local.json)：22 项检查通过，44 次业务请求和 2 次独立 cleanup 请求，业务响应 39143 bytes、cleanup 178 bytes；四个 scope 均撤权确认，最后[清理核验](evidence/runs/m0-model-proxy-local-1788611379474-ec85ee9b/cleanup-verification.json)确认 8794 关闭、UI 4173 原进程保持。显式取消和管理撤权均观察服务端流结束、cancelled/unknown 账本、预留保留及 active=0；intent 后实际 ctx.abort 保留 dispatched/未知状态，fixture=0；重启和拒绝重放后实际计数与账本不变。这是后续云部署之前的本地历史证据。
- [断线取消失败记录](evidence/runs/m0-model-proxy-local-1788611138874-d62e1d8d/model-proxy-local.json)显示，启用请求 signal 相关开关后，6 秒观察窗口仍有 1 个 active 请求；不宣称断线传播已修复。显式 `/v1/cancel` 是当前可靠取消契约。受控取消与 ctx.abort 的运行时错误保留在[日志](evidence/runs/m0-model-proxy-local-1788611379474-ec85ee9b/workerd-observed.log)，不能声称无错误日志。
- 最新 [Preview 预算回归](evidence/runs/preview-browser-1788605434924/artifacts/preview-browser.json)：真实本地 Chrome 的 14 个用例通过，对应前轮冻结源码；本轮模型代理/宿主变更未重跑浏览器，不能写成当前整仓浏览器验收；业务观察 199 请求、23868 bytes，约 32.8 秒，独立 cleanup 2 请求、226 bytes、90 ms，浏览器已关闭。仍保留 SDK `Network connection lost` 关闭日志，未归因；本地功能通过不替代 T07 云验证。[清理证据](evidence/runs/preview-regression-20260905104749/helper-cleanup.json)及[最终环境](evidence/runs/preview-regression-20260905104749/after.json)确认本轮 Workerd 与 4 个 helper 已停止，Docker 活动容器为 0、8791 无监听，UI 4173 保持原进程；15 条 SDK 关闭异常保留在[脱敏日志](evidence/runs/preview-regression-20260905104749/workerd-redacted.log)。
- [T02 分离边界](evidence/runs/m0-boundary-20260905083026073/boundary-local.json)：10 个 case 全部通过（6 个输入拒绝、完整 body 正控制、deadline、isolation、tenancy）；`probeSourceStableDuringRun=true`，真实 `SIGUSR1` 计数为 1，trusted canary、Session、两个写目标和 health 均未变化。SDK 的 `foreign_session_write` 与 forged write 返回 200，但只有各自独立 project 文件发生变化，说明能力被限制在 project 范围内，Session 不是安全边界；raw signal 为 `target_not_addressable`，未发送。两个最长 48 字符且尾部为 hyphen 的 run ID 清理均获 ack。
- [T08 三场景](evidence/runs/m0-recovery-20260905070637920/summary.json)全部通过：[SSE 断线](evidence/runs/m0-recovery-20260905070637920/disconnect.json)后 alarm 继续推进并完成；[杀 Pi 进程](evidence/runs/m0-recovery-20260905070637920/process.json)和[销毁 Sandbox](evidence/runs/m0-recovery-20260905070637920/container.json)均在真实 Pi 的固定长流窗口内确认中断。恢复使用新 generation、独立物理 Sandbox 和已提交 Session，新回合读取旧上下文，不重发未完成请求；旧事件被拒绝，按游标补发事件及重复接受请求保持一致。[Workerd 重启](evidence/runs/m0-recovery-20260905070637920/workerd-restart.json)后，三个报告的状态、保存收据与事件仍一致。供应商为本地 fixture，完整项目文件恢复和生产 durable Turn 不在此证据范围。
- [T10 本地发布策略](../spikes/m0-release/README.md)：8 个真实子进程测试在当前完整检查通过，覆盖准入失败零派发、旧任务固定版本、候选失败保留旧选择、摘要校验恢复、实际文件副作用后崩溃不重放，以及启动 / 停止 / checkpoint 竞态。两个 release 为同一固定程序的不同启动参数，云 Worker / 镜像混合发布仍待验证。
- [Storage staging baseline（历史）](evidence/runs/m0-storage-staging-20260905095532532/cloud-baseline.json)：部署观测时间为 `2026-09-05T10:01:39Z`；旧版本的六个外部 HTTP 检查成功、9 项 baseline observations 全为 true，只覆盖部分保存原语。[部署记录](evidence/runs/m0-storage-staging-20260905095532532/deployment.json)与[构建记录](evidence/runs/m0-storage-staging-20260905095532532/baseline-build.json)保留，不能代替当前源码验证。
- [Storage 云 fault 原语](evidence/runs/m0-storage-cloud-bodyfix-20260905103521004/storage-cloud.json)：部署验证记录与 artifact 对应于 Worker version `e0d311aa-ab18-4b55-9fd8-0c188376041b`；`checksPassed=true`、`sourceStableDuringProbe=true`，21 requests、74848 bytes。实际上传中断确认 65536 bytes consumed 且对象不存在；提交前/后崩溃均有新实例与指针核对；SSE 断线/游标重放应用一次并去重；GC 删除 3 个 orphan、保留 5 个对象，第二次 sweep 删除 0。[主控 T06 复核](evidence/runs/m0-storage-cloud-bodyfix-20260905103521004/primary-review.json)后，[T06 gate summary](evidence/runs/m0-g0-t06-cloud-20260905/G0-T06-gate-summary.json)正式记录 `status=passed`。该签收仅覆盖 T06，不能关闭整个 G0。
- [Storage 旧版本失败记录](evidence/runs/m0-storage-cloud-deploy-20260905102546347)：旧版本首次 fault run 的 `init` 返回 404（8 requests、0 mutations），已由 bodyfix 版本重新验证；保留作历史失败证据。
- [完整文件链路](evidence/runs/m0-files-20260905061426155/artifacts/files-local.json)：20 次真实操作、12 个目录/文件条目、内容摘要和权限核对；经 R2 提交后销毁 Sandbox，新运行时从持久文件恢复，并再次创建、重命名和删除探测文件；旧 generation 被拒绝，共两条保存事件。[重复请求](evidence/runs/m0-files-20260905061426155/artifacts/duplicate-run.json)与 [Workerd 重启](evidence/runs/m0-files-20260905061426155/artifacts/workerd-restart.json)均读取相同报告和版本。这是固定项目及合成 Session 的本地验证，未验证并发恶意写入、真实 Pi 恢复或云 VM。
- [保存适配器复测](evidence/runs/m0-recovery-20260905070637920/storage-metadata.json)：本地 Workerd 九项观测通过，包括元数据故障同时回滚保存收据与事件、同版本重试更新元数据但不重复保存，以及上传/提交故障、丢失响应、真正并发的父版本竞争和旧 generation 拒绝。[前轮七项观测](evidence/runs/m0-storage-20260905062641255/artifacts/storage-local.json)保留。
- [Preview 浏览器链路](evidence/runs/preview-browser-1788597480759/artifacts/preview-browser.json)：14 个 case 全通过，覆盖 alpha/bravo 合成主体、同租户独立 session、复制 URL 拒绝、一次兑换、真实 Chrome 152 HTTPS iframe/独立 origin、JS/HTTP/WS、CDP Cookie/Origin/403/CORS 取证、logout 后 12ms 关闭 WS、实际 19399ms 的 20 秒 TTL、generation 替换、两租户及同租户两实例。该证据仅是 local same-site/different-origin synthetic fixture，不是生产登录、跨站 Cookie 或云验收。[helper 清理](evidence/runs/preview-browser-1788597480759/artifacts/helper-cleanup.json)确认四只 helper 停止且剩余为 0；自身两处流取消 Promise 已补充拒绝处理并通过内存流回归；最终真实浏览器仍记录 15 条 [Network connection lost 日志](evidence/runs/preview-browser-1788597480759/artifacts/worker-stop.log)，尚未归因。锁定 SDK 的异步转发/关闭路径是复查候选，功能通过不等于异常已解决。
- [前轮 Preview HTTP / WS](evidence/runs/preview-live-1788589137844/artifacts/preview-local-smoke.json)保留为历史证据；旧 shared-origin/bearer 结果不代表本轮浏览器身份与 origin 结论。
- [本轮 Boundary push 失败](evidence/runs/m0-boundary-staging-20260905100830706/cloud-after-failed-push.json)：第一次 push 因 registry broken pipe 退出 1；失败后 Worker/DO bindings 已存在但 Containers 为空。[retry 终态](evidence/runs/m0-boundary-staging-20260905100830706/cloud-after-retry-timeout.json)及[最终 reconciliation](evidence/runs/m0-boundary-staging-20260905100830706/push-reconciliation.json)确认单并发认证兼容重试仍因 proxy broken pipe 退出 1；`deploy-retry-1.json` 的错误 `exitCode: 0` 不能当成功。远端 Worker version 为 `61647393-9f5e-4187-98a3-218a4a188116`，Container apps 仍为空；[独立镜像 push 记录](evidence/runs/m0-boundary-staging-20260905100830706/image-push-oauth-trusted.json)保留。不能称 Boundary 云隔离测试已执行或部署成功。
- [Registry 分块推送终态](evidence/runs/m0-registry-chunked-trusted-20260905111316067/result.json)：总耗时 `131184 ms`；`regctl v0.11.5` 官方 SHA 已核验，配置 4 MiB chunk、单并发；首个 30,649,033-byte layer 在 120 秒预算内超时，stderr 为 `failed to send blob (chunk), context canceled`，随后 HEAD 404，manifest 未发布、Container 未部署，未重试同一上传。`payloadBytesSubmitted` 是客户端输入，不是网络实际字节；费用未知，模型请求与云 VM 均为 0。该记录不证明 Registry 已支持 PATCH。
- [本轮五套 dry-run](evidence/runs/m0-validation-20260905084126533/builds.json)全部退出 0，构建期间源码清单一致；[镜像摘要](evidence/runs/m0-validation-20260905084126533/images.json)、[候选清单](evidence/runs/m0-validation-20260905084126533/candidate.json)与[复验结果](evidence/runs/m0-validation-20260905084126533/verification.json)已关联最终检查。候选只是本地完整性清单，`deployed=false`、`canPromote=false`，构建来源未签名认证。前轮构建保留为历史。
- [真实 Pi 请求](evidence/runs/m0-initial/artifacts/pi-live.json)：本机通过已配置的 `opencode-go / deepseek-v4-flash` 发送三次受限请求，两次完成后上下文恢复成功，第三次观察到取消。供应商响应头未返回可用请求 ID。首次脚本尚未采集 SDK `responseId`，其输出中的 `cost: 0` 是未配置价目的占位值，不能视为实际费用；取消请求的用量也不是最终结算凭据。后续代码已修正证据口径并通过本地测试，没有额外重发付费请求。此历史记录不证明最终宿主已通过云端或请求关联验收。
- [本地保存与并发](evidence/runs/m0-initial/artifacts/storage-workerd-concurrent-local.json)：上传中断、提交前失败、提交后响应丢失、真实并行的父版本竞争和旧 generation 拒绝均符合预期；一个竞争请求成功，另一个发生冲突，仅新增一个保存事件。
- [Workerd 进程重启](evidence/runs/m0-initial/artifacts/storage-workerd-restart-local.json)：停止并重新启动本地服务后，报告和保存收据保持一致。不是云容器销毁恢复的替代证据。
- [前轮本地分离探针](evidence/runs/m0-initial/artifacts/boundary-isolation-local.json)保留为历史观测；最新 T02 结论以 `m0-boundary-20260905083026073/boundary-local.json` 为准。
- [两个本地 Sandbox](evidence/runs/m0-initial/artifacts/boundary-tenancy-local.json)：同一路径内容互不覆盖。产品登录、跨租户完整 API 与云 VM 仍待验证。
- [第一次出口观测](evidence/runs/m0-initial/artifacts/boundary-egress-local.json)：可信端限定健康响应成功，其他 HTTP 请求被拒绝或发生传输错误；仅观察到 TCP 连接成功，不能据此判断应用数据已到达外网。[v2 协议复核](evidence/runs/m0-initial/artifacts/boundary-egress-local-v2.json)实际发送固定非秘密 DNS 查询后，通道在 DNS 响应前关闭，收到 0 字节；没有匹配的应用响应。仍不能以本地结果关闭云出口门禁。
- [镜像构建记录](evidence/runs/m0-initial/artifacts/local-images.json)：包含最终本地镜像 ID、架构和 Pi import 检查结果；未推送云注册表。
- [G0 汇总](evidence/runs/m0-g0-20260905/artifacts/summary.json)：十个门禁均无 staging passed，`accepted: false`；记录器以非零状态退出，符合阻断要求。

上述文件保留首次观测，不覆盖旧证据。需要区分单元 fixture、真实供应商、本地 Workerd、本地 Docker 和 staging。本轮五只 recovery 开发代理 helper 已按完整名称和镜像核对后[停止并确认](evidence/runs/m0-recovery-20260905070637920/helper-cleanup.json)；前轮两个 Preview helper 的[清理记录](evidence/runs/m0-build-20260905063357356/helper-cleanup.json)保留。`destroy_acknowledged` 只覆盖 Sandbox，不应推断所有开发 helper 已退出。本轮 M0 服务已停止，保留本地 UI 和 Colima。

## 版本与环境

| 项目 | 锁定 / 实测 |
|---|---|
| Pi SDK / 配套 pi-server | `0.85.0` / `0.85.0`；配套包弥补 SDK 实际导入缺少声明的依赖 |
| Sandbox SDK / Containers 库 | `0.12.9` / 锁文件解析为 `0.3.7` |
| Wrangler / TypeScript | `4.129.0` / `7.0.2` |
| 本机 Node | `25.3.0` |
| Sandbox Linux 镜像 | 可信宿主为 Node `22.23.2`；项目镜像 Python `3.11.14`；均为 `linux/amd64`。可信信号正控制使用 Node 自身信号，不依赖 Python |
| 本地容器宿主 | 独立 Colima `riffology-m0`；2 CPU、4 GiB、20 GiB 稀疏磁盘，不挂载宿主目录，不切换全局 Docker context |
| Cloudflare | 目标账号 `8b0d70250211aa10d89e20605a1c7e5e`；`wrangler whoami` exit 0，OAuth 凭据由加密文件与 macOS Keychain 保存；`riffology-m0-checkpoints-staging` 为私有 APAC/Standard 桶；Storage Worker 新版本已部署并完成 T06 单项签收，Boundary push 终态失败且 Container apps 为空，Preview 无专用域名 |

[历史环境报告](evidence/runs/m0-validation-20260905083304251/preflight.json)中本地检查通过，云检查因 `auth-required` 阻断；[历史连接器检查](evidence/runs/m0-validation-20260905083304251/cloud-connector.json)记录当时的 Workers Paid 与 R2 缺口。当前环境证据显示：[cloud-before](evidence/runs/m0-environment-20260905094527503/cloud-before.json) 的 Containers/R2 GET 均为 200，[bucket-create](evidence/runs/m0-environment-20260905094527503/bucket-create.json) 创建指定桶 exit 0，[bucket-verification](evidence/runs/m0-environment-20260905094527503/bucket-verification.json)确认 APAC/Standard、public development domain disabled、custom domains 为空；[preflight](evidence/runs/m0-environment-20260905094527503/preflight.json) 于 2026-09-05T09:46:34.008Z 记录 4 项本地与 3 项 CLI 云检查全部 passed。Storage 新版本的[部署验证](evidence/runs/m0-storage-cloud-bodyfix-20260905103521004/deployment-verified.json)与[云 fault 原语](evidence/runs/m0-storage-cloud-bodyfix-20260905103521004/storage-cloud.json)已由[主控 T06 复核](evidence/runs/m0-storage-cloud-bodyfix-20260905103521004/primary-review.json)并正式签收；Boundary [最终 reconciliation](evidence/runs/m0-boundary-staging-20260905100830706/push-reconciliation.json)显示 push 失败且 Container apps 为空。上述证据只证明资源配置、局部原语或失败状态，不等于全部 M0 Worker/DO/Containers 已部署或 G0 通过。基础镜像 digest 见 `infra/m0-*.Dockerfile`，本轮产物对应关系见候选清单。

[账号复核](evidence/runs/m0-environment-20260905094527503/account-binding.json)单独确认当前 CLI 授权包含配置指定账号；preflight 中的 `accountId: null` 是该记录器未提取到账号字段，不代表完成了账号一致性校验。

## Pi 代理镜像（本地）

[新镜像与发布范围](m0-pi-proxy-image.md)已冻结：真实 Linux SDK 与两个独立 staging-fixture child 的断网调用/恢复检查通过，六个 COPY 文件与冻结九文件上下文一致，保留 Sandbox 默认入口。trusted 实际重复构建一次的过程偏差、缺失的首次退出码及两种 index 均保留；没有上传、云部署或真实模型调用。当前 trusted 出口与云监督器尚未接通，G0 状态不变。

## Pi 与持久模型代理联调（本地）

[当前诊断收据](evidence/runs/m0-proxy-pi-local-1788622591199-4e3a43ff/proxy-pi-local.json)为 10 项通过、2.380 秒：真实 Pi 在三个独立进程中分别完成首次调用、磁盘 checkpoint 恢复和流式取消。第一轮进程关闭后保存 0600/fsync checkpoint，实际 DO 实例重启后 nonce 改变但账本不变；恢复实例发送完整历史。三个 wire 正文 SHA 与 DO 持久收据、平台请求 ID 一致；前两轮 completed/known，取消轮 cancelled/unknown，合成预留 576 μUSD 保留，金额仍为 null。7 次业务控制请求、13,354 响应字节；2 次清理请求、4,645 字节；子进程另有 3 次模型 fixture 请求及 1 次取消请求。

[协调器](../scripts/m0/proxy-pi-local.mjs)持有 operator secret，每个[Pi 子进程](../scripts/m0/proxy-pi-child.mjs)只接收当前 capability。父进程等实际 close 后回收临时目录，超时/输出异常保留退出事实，清理失败独立记录。初始化与 scope 仍为合成诊断身份；本地进程分离不证明 VM 安全隔离，fixture 不证明真实模型记忆，云 Worker 和旧冻结镜像没有包含新诊断入口。G0 仍为 1/10，T01/T09 未通过。

历史[首次 9 项通过](evidence/runs/m0-proxy-pi-local-1788621797044-105263a8/proxy-pi-local.json)和[服务定时退出后的 0 项失败](evidence/runs/m0-proxy-pi-local-1788622105371-0cc1d1af/proxy-pi-local.json)保留。首次全检在新增 TypeScript 测试导入内部 mjs 时缺少声明而失败：[记录](evidence/runs/m0-local-20260905153200141/local-checks.json)；诊断测试移至现有 mjs 测试目录后通过，该版源码与当时全检一致，本轮入口变更另见最新全检。Workerd 日志仍有受控 restart 和流取消的异常信息；持久终态/撤权/active=0 已分别核验，不能称日志无异常。[主控复核及清理记录](evidence/runs/m0-proxy-pi-local-1788622591199-4e3a43ff/primary-review.json)确认：本轮 Workerd 按预设时限退出，8794 无监听，原 UI 4173/PID 88606 保留；[脱敏日志](evidence/runs/m0-proxy-pi-local-1788622591199-4e3a43ff/workerd-redacted.log)保留诊断异常。

## 本轮复审关闭的问题

主控负责集成与门禁；两个复杂子任务分别实现 Pi 宿主和 Sandbox 探针，低成本 subagent 负责证据、环境工具与说明。主控复审后修复了以下问题：

1. 证据汇总可能让局部通过盖过失败、混合不同版本，现改为失败阻断并复验文件摘要。
2. Pi 在等待凭据时取消，晚返回仍可能发请求，现由回合 AbortController 阻断并验证零请求。
3. SDK 估价为零及取消用量可能被当成费用依据，现显式标记金额未知、用量未对账。
4. 原“并发”测试实际顺序执行，现增加真正并发的内存和 DO 检查。
5. TCP connect 可能被误当成端到端连通，现拆分连接和协议响应证据。
6. Sandbox ID 超过 SDK 的 63 字符限制导致探针未开始；现从服务端协调者标识生成长度固定的 ID，并捕获清理初始化失败，保留首次失败证据。
7. 文件模式 0640 不符合 checkpoint 允许集合；已统一模式契约，以真实文件系统复核内容和权限。
8. 文件清理与新运行可能竞争移除 watchdog；现清理同样占用协调者运行锁。跨 generation 复用相同 Revision 也不能绕过父版本与 generation 校验。
9. WebSocket 101 响应不能沿普通 RPC 返回；Preview 现经 SDK fetch 传输进行握手，并在转发期间复核撤权。
10. 本地发布清单可能接受过期检查、漏源文件或被替换的构建产物；现复验完整源码、必需字段、依赖锁、检查记录和产物摘要，始终禁止据此推广。
11. 保存指针与恢复终态若分两次提交，崩溃后可能出现“最终版本已保存但回合仍中断”；现将保存收据、事件和协调者元数据放入同一 DO 事务，注入元数据失败验证共同回滚。
12. 旧 generation 的延迟销毁可能误杀新恢复实例；现按 generation 分配独立物理 Sandbox，外部调用捕获目标 generation 后再执行。
13. SSE 首次读取可能无限等待，故障注入也可能错过真实流窗口；驱动现限制连接 / 读取时间，并以实际流开始、进程状态、最终文件和停止确认判定窗口，错过即失败。
14. 发布探针的晚启动、晚响应及 checkpoint 提交可能覆盖停止状态；现等待启动收尾、拒绝晚结果复活，并在无异步间隔的授权与指针切换间执行停止约束，真实子进程竞态测试通过。

15. 浏览器 opaque ID 以普通对象键读取时可能命中原型属性；现要求 64 位十六进制标识并做 own-property 检查。
16. 登出之前发起的授权 RPC 可能晚到；现先持久化 sid 撤权围栏，HTTP 返回、WS 注册和发送前同步重验。旧 alarm 只处理已到期的 active 状态。
17. 借所有者浏览器导航可能提前消耗复制的 ticket；现仅在正确 nonce 的最终兑换事务中消费 ticket/code/challenge。
18. HTTP 请求上传未结束时，本地代理延后交付 Worker 拒绝；探针增加完整 body 正控制，并完成延迟上传后检查 `invalid_body`，不声称提前收到响应。
19. 默认健康检查路径和可信镜像实际依赖不匹配；改用明确 `/health`，可信服务通过固定 nonce 入口只向自身发送 SIGUSR1，再独立回读计数。项目侧缺少 pidfd 或身份不匹配仍拒绝发送。
20. SDK 写入返回 200 不能说明跨容器成功或失败；两种写入使用独立目标，Worker 分别核对项目 marker 与可信原内容。
21. CORS 拒绝时 Playwright 未交付普通 response 事件；现在用 Chrome CDP 对同一 iframe 请求关联 Cookie、Origin、网络 403 和 CORS 失败。
22. 两条拒绝路径的流取消 Promise 会产生未处理拒绝；已补 catch 并验证原 400/502 状态不变。SDK 内部关闭日志未因此标记解决。

失败记录保留：[请求上传等待](evidence/runs/m0-boundary-20260905075738294/boundary-local.json)、[健康路径](evidence/runs/m0-boundary-20260905080501982/boundary-local.json)、[可信镜像缺少 Python](evidence/runs/m0-boundary-20260905081020250/boundary-local.json)、[SDK 写状态假设](evidence/runs/m0-boundary-20260905082511433/boundary-local.json)、[普通浏览器响应事件超时](evidence/runs/preview-browser-1788596255014/artifacts/preview-browser.json)。这些记录未覆盖或改写；成功记录来自修正后的独立运行。

## 历史未通过清单（已被本页顶部最新签收替代）

| 门禁 | 现状和必须补齐的工作 |
|---|---|
| T01 / T03 | 代理原语、最终 payload hook 和离线 SDK 检查已实现；仍需将受控 Pi 镜像接入云端限定模型代理；验证真实流式事件、请求关联、取消、恶意资源首次启动和恢复；模型 wire 与预算缺口见 [前置记录](m0-model-proxy-budget.md) |
| T02 / T04 | T02 本地 10 case 已通过；云上分离信任域已有局部观测；仍需解决慢上传负向失败，并补控制 RPC/失效 capability 和跨对象入口矩阵。T02 的成功写入仅限 project，不能描述为两次写入被拒绝 |
| T05 | 本地完整 20 次 CRUD、保存、销毁重建与恢复后写入已通过；在云 R2 / Sandbox 重做，补真实 Pi Session 和故障窗口 |
| T06 | Storage 云 fault 原语已单项签收 `status=passed`；实际上传中断、提交前/后崩溃、SSE 游标重放去重、GC 3 删 5 留均有证据；总汇仍仅 1/10 staging passed，不能扩展为整个 G0 |
| T07 | [staging 技术门禁已签收](evidence/runs/m0-g0-t07-cloud-20260906/G0-T07-gate-summary.json)：当前同站点不同 origin、受控测试身份的完整入口、HTTP/JS/API/WS、Cookie 网络正反控制、CSRF、撤权、过期及 generation 替换均通过；SDK 无公开端口。M1 正式登录后重验生产链路，跨站第三方 Cookie 支持另行验收 |
| T08 | [三组云恢复原语已签收](m0-recovery-cloud-validation.md)：浏览器关闭后继续、SDK kill Pi / 容器销毁后新实例恢复、旧代事件和写入拒绝；真实 Pi + 本地 SSE fixture，生产 Turn / Run 另属后续阶段 |
| T09 | 原子预留、DO 账本与合成身份已通过本地及 staging fixture 集成；仍需云出站、DNS、真实身份/供应商接入和依赖白名单；不根据本地 HTTP 拒绝宣称所有网络均隔绝 |
| T10 | 本地候选完整性及 8 项子进程发布策略测试通过；仍需两个真实镜像、新旧 Worker 混合窗口、云启动失败、实际 rollout 和回退验证 |

本轮 T02/T07 的本地补验已完成，环境认证、Workers Paid/Containers 资格和 R2 bucket 配置前置已完成；Storage T06 云 fault 原语已单项签收，Boundary 单并发认证兼容 push 与后续 regctl 分块上传均失败且 Container apps 为空，Preview 尚无域名、T07 云 runner 未执行。本次云验证模型调用与云 VM 启动均为 0，Registry 客户端输入字节不等于网络实际字节，费用未知；历史本地供应商调用另有独立记录。预算仍为 US$5（LLM 最多 US$1，不含 Workers 月租）。总汇为 1/10 staging passed、`accepted=false`、exit 2；下一步按上表完成其余门禁，G0 仍未通过，暂不进入 M1。

参见[职责 ADR](adr/0001-pi-project-trust-boundary.md)、[M0 运行手册](m0-local-runbook.md)及[开发部署计划](development-deployment-plan.md)。

引用确认补充：Dispatcher 现在严格验证 retain 回执的 artifactId、kind、referenceId 和 active 状态；错误或已释放回执不得写入事件日志，失败工具也不得携带 Artifact。新增故障注入验证 retain 成功但 journal append 失败后，只观察原 Runtime 并幂等登记同一事件。该补充已通过 TypeScript 和 Dispatcher / 真实 Workerd 定向 26 项测试，尚未重跑整仓检查；此前 304 项证据对应此前冻结源码。

事件引用释放：`artifactEventReleaseEligibility` 只读核对完整 Workspace scope、原 Turn 与 dispatch；活动回合和仍在日志中的事件保持引用。`releaseRetiredArtifactEvent` 在满足前置条件后调用唯一 ArtifactStore，并严格核对已释放回执；丢响应可重试同一引用。未知 Turn 和错误 dispatch 失败关闭。该接口不删除对象，Tool Ledger 和已保存 Pi Session 中的 Artifact 收据仍需独立保留策略。

最新事件释放切片验证：TypeScript 通过，M2 全量 311/311 通过，检查期间源码摘要一致。[不可覆盖回归记录](evidence/runs/m2-event-retirement-1788781004034/result.json)及日志仅证明本地结果；未部署，新增模型调用为 0。

事件释放的真实 Workerd 验证已完成：生产 WorkspaceAgent 在事件保留时拒绝释放，压缩后只释放对应 turn_event；跨租户请求拒绝，tool_effect 保持 active，Artifact 原字节继续可读。Workerd 完整停止并重建后，同一释放请求返回原回执，读取仍一致。[本地持久化验证记录](evidence/runs/m2-event-retirement-workerd-1788781122274/result.json)包含 5/5 定向测试，源码在检查期间稳定；TypeScript 与 diff 检查通过。该验证使用真实 DO/SQLite/R2 和显式 Runtime fixture，不代表云 Sandbox 或真实模型验收。

自动事件引用维护候选：ArtifactStore 使用自身独立 alarm，不改写 Workspace 的 provisioning / Turn 共享唤醒。登记新事件引用前预置唤醒；已有活跃引用在 Store 再次激活时补唤醒（从不再访问的旧实例仍需运维启动）。每轮固定 rowid 上界，持久保存游标，每次最多 50 条；轮末归零，1 小时后重查。每次扫描前先预置 1 分钟重试，满页在 1 秒后续扫。向派生 WorkspaceAgent 查询终态及日志缺失证明时不持有 Store 串行锁，避免跨 DO 回调死锁。不可访问或非 ready Workspace 保守保留，并在下一轮重查；此类引用不阻塞其他 Workspace。该候选仅释放 turn_event，不释放 tool_effect，也不删除 R2 对象。

自动调度验收：TypeScript 和 M2 315/315 通过，[冻结回归证据](evidence/runs/m2-retirement-scheduler-1788781388088/result.json)记录检查期间源码一致。真实 Workerd 验证由 Store alarm 释放已退出 journal 的事件引用，随后手动重放返回原回执；对象仍可读且重启后一致。只读子 agent 审查未发现本切片阻断问题。该轮尚未覆盖的维护鉴权与 highwater 恢复已由下述补充验证完成；完整 GC 生命周期仍未完成。

维护鉴权修正：WorkspaceAgent 的引用维护接口现按持久化 WorkspaceTask、tenant/project/workspace/generation 和派生 actor 验证身份，不再要求 projection ready；journal 仍要求原 Turn 已终止且事件和幂等回执已退出窗口。用户读取接口继续要求 ready。真实 Workerd 注入 projectionConfirmed=false 后，用户 Artifact 读取被拒绝而 Store alarm 仍能释放旧事件引用；恢复 ready 后原字节继续可读。TypeScript、5 项定向测试和 diff 检查通过。测试验证非 ready 状态下的维护行为，不代表真实云停止流程验收。此前“非 ready 会永久 deferred”的限制已由此修正；缺失状态或身份不符仍保守保留。

扫描恢复补充：真实 ArtifactStore SQLite/R2 测试创建 51 条事件引用，第一页 50 条全部 retained，保留原游标及扫描上界后再插入第 52 条并完整重启 Workerd。下一页只释放原上界内第 51 条，新引用在下一轮才被处理；未释放引用与 tool_effect 仍 active，R2 保持一个对象。[最新冻结证据](evidence/runs/m2-retirement-recovery-1788781623486/result.json)记录 TypeScript 通过、M2 316/316、检查期间源码一致。未部署，新增模型调用为 0。

整仓复核：[完整检查](evidence/runs/m0-local-20260907114833277/local-checks.json)通过 M0 349 pass / 1 skip、M1 146 pass、M2 316 pass，源码在检查期间一致。随后只读退出审查定位 Project 工具停止 / Checkpoint 静止证明为当前优先工作包：Pi 停止不代表远端工具停止，现有取消验收不足。已先修复 Bash 正常退出时遗留原进程组后台任务的问题，并新增延迟写入回归；这不代表逃离原进程组的进程或产品级取消已被覆盖。后续代码变化不包含在上述整仓源码摘要中。

### 2026-09-07 Project 进程静止候选与 M0 并发修复

Project freeze 已接入 SQLite 准入 fence、root spawn/seal 互斥和 UID 10001 进程清理；平台 archive 共享锁并拒绝迟到 restore。静止证明不改写工具 unknown 结果。真实本地 Docker 的 9 项检查与源码稳定性记录见 [证据](evidence/runs/m2-project-quiescence-1788782799943/result.json)。M2 独立测试 324 项通过；当前证据使用缓存镜像挂载源码，不是新发布镜像或云验收。

首次完整检查 [失败记录](evidence/runs/m0-local-20260907120601634/local-checks.json)定位到 M0 release-probe 的既有竞态：意图持久化后提交结果再次申请锁，可能输给重复请求的只读检查而遗留 running。修复仅允许原执行者在结果提交阶段有界等待 1 秒，重新核对 pid/digest，不重发 effect、不接管陈旧锁；真实进程回归 12 项通过。完整检查需以修复后的新记录为准。

修复后的[完整检查](evidence/runs/m0-local-20260907121022570/local-checks.json)通过且执行期间源码稳定：M0 350 pass / 1 skip，M1 146 pass，M2 324 pass。历史云 completion 验证仍默认固定原发布源码摘要，本地 fixture 显式以当前源码独立摘要验证，包含错误摘要拒绝回归。两份失败记录保留；本轮未部署、未调用模型、未提交或推送。下一步仍为真实产品链的启动/停止竞态与故障恢复验收。

### 2026-09-07 启停竞态、丢响应与 SDK 产品链恢复

[Docker 故障证据](evidence/runs/m2-quiescence-recovery-1788783405917/result.json)覆盖已预留命令与 seal 竞争、归档摘要稳定，以及生产 SQLite supervisor/native 的开始响应丢失、停止证明丢失和重开数据库：effectStarts=1，sealStarts=2，原 effect 保留 unknown。该传输为 Docker SDK-shaped adapter。额外增加全新容器缺少恢复标记时拒绝 freeze，防止默默保存空目录。

[真实 Workerd + SDK 验证](evidence/runs/m2-product-turn-provider-disabled-20260907121618357/primary-review.json)使用新构建镜像通过 provider-disabled 回合保存、容器销毁后恢复、损坏基线拒绝和 Workerd 重启恢复。模型预算 attempts/dispatchedCalls 均为0。它不证明真实模型续接，也不等于 SDK 运行中工具取消故障注入。首次使用默认2GiB Docker 环境时预检失败，改用已运行的4GiB `riffology-m0` 专用环境后通过；未重启其他环境、未部署云端。

### 2026-09-07 20 次真实文件变更与恢复验收

[完整产品链](evidence/runs/m2-product-turn-crud-fixture-20260907131241876/primary-review.json)已通过：测试专用确定性模型响应驱动真实 Pi，经 Tool Bridge、SQLite Ledger、capability、Sandbox 完成 mkdir 前置以及20次文件变更（创建8、编辑4、重命名4、删除4）。R2归档逐字比对最终4个文件，Files列出相同结果；首回合净Diff为新增目录1+文件4，回合内创建再删除不误算为基线删除。销毁两种Sandbox后，新回合真实读取4个文件、归档哈希一致、Diff为空；Workerd重启恢复同一收据。模型调用与预算尝试均为0；这不是自然模型推理能力验收。

真实链路修复了两处问题：Bridge首次得到running后需在截止时间内观察同一effect直到终态；默认工具deadline留出5秒时钟余量，服务端120秒上限不变。执行不重发，传输异常保留unknown。[完整本地检查](evidence/runs/m0-local-20260907131307395/local-checks.json)通过且源码稳定，M0 350 pass/1 skip、M1 146 pass、M2 326 pass。失败诊断记录保留。

**下一优先缺口：初始内容衔接。** M1的README/官方模型虽已初始化和保存，但首个M2 Turn的workspace base为null，恢复空归档，尚未承接M1内容。应建立独立初始base收据并验证checkpoint与模型包，供首回合恢复及Files/Diff共同使用；不得伪造已完成Turn，也不得复制旧控制目录。原M1对象未被删除。当前验收明确使用空M2基线并通过真实Bash建立model目录，不能据此签收官方模型首次进入Agent。未部署云端、未提交或推送。
