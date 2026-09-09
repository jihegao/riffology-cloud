# M3 Browser Preview 开发与部署执行计划

## Observer Artifact 写入清单与回收前置（2026-09-08 本地候选）

Executor 在 R2 写入前持久登记完整 command 与收据，每个观察仅允许 state 和对应 view/screenshot 两项。同一收据仅首次认领可以派发 put；确认丢失或重启后仅允许读回，不重新写入。登记同步之后、实际调用 put 之前同步复核执行停止栅栏，中间不插入异步等待。

清单分别保存 `pending / acknowledged / uncertain` 写入状态及 `contentVerified`。`pending` 包含尚未发出或已发出但没有确认的情况，统一保守处理；readback 成功只更新内容验证，不清除未决写入。Executor 提交完成结果时，在同一 SQLite 事务保留结果引用；结果提交失败不会留下新引用。

物理删除尚未实现。后续必须先完成 Workspace/Executor 两端幂等引用释放、永久禁止重新附着、写入结束证明、持久删除意图与重启对账。停止浏览器、回合失败、时间到期或对象暂时不存在，均不能证明未决 R2 写入已结束。当前未被结果引用的对象仍保留，缺少清单的历史对象也不自动删除。测试证据入口见[开发状态](development-status.md)。

## 历史观察结果读取合同（2026-09-08 本地候选）

用户读取入口为 `GET /api/workspaces/:workspaceId/turns/:turnId/observations/:commandId/artifacts/:part`，`part` 仅接受 `state` 或 `view`。平台从已完成的 Observer 调用记录选择收据；客户端不能指定 R2 key 或任意收据。Gateway 和 Workspace 校验当前项目访问权限及 ready 状态，Workspace 另核对原 Turn、Session、dispatch、generation 和用户归属。当前认证版本由 Catalog 验证，不要求与历史会话版本相等。

历史读取不要求执行开关开启、原回合活跃或原 Preview 仍存在。Executor 仅提供已持久完成结果所引用的对象，未知调用和孤立对象不能读取；已经停止并封禁的完成记录仍可读取。读取使用最长 5 秒的临时 RPC 授权，包含前后权限复核、长度与 SHA-256 校验；调用结束后迟到授权失效。公开响应使用固定 JSON/PNG 类型、禁止缓存和内容嗅探，并标记 `x-riffology-observation-state: historical`。历史截图或状态不得作为当前运行状态展示。

此入口属于平台产品功能，项目内 Pi Agent 不控制鉴权、对象定位或公开响应策略。本地测试与冻结检查见[开发状态](development-status.md)；Artifact 引用保留、回收策略、用户界面与 Pi 工具接入仍须分别完成。本候选不开放生产绑定，也不替代原生 Browser 网络隔离与退出证明。

更新：2026-09-08。目标是让用户与 Agent 在同一个已保存版本、同一个 Preview 服务实例上观察和修改仿真；平台负责服务生命周期、权限和资源，项目应用负责领域状态与交互。

本计划依据[系统设计](mvp-system-design.md)和[平台与项目职责](platform-project-boundary.md)。**当前已实现 Preview 声明、保存版本解析、service Run/共享配额、持久调度与 Runtime DO，以及通过 Docker 验证的原生启动器。尚未打通实际 Sandbox SDK、Workspace、Preview 网关和 UI 的完整产品链路，M3 未交付。** 源文件摘要不证明 Python 可运行、依赖已安装、服务健康或观察无副作用。后续每阶段均须留下与实际执行范围相符的独立验收记录。

Observer 后续按[独立授权与实施契约](m3-observer-contract.md)接线，覆盖真实 Pi 工具入口、受控代理、项目观察接口、收据及取消/替换竞态；该契约是待实现要求，不是能力已开放的证明。

[该阶段历史本地检查](evidence/runs/m0-local-20260908090554379/local-checks.json)通过且当时源码摘要稳定：M0 350 项通过、1 项跳过，M1 182 项、M2 360 项、M3 108 项通过，合计 1000 项通过；此记录不包含后续 HTTP 接线，最新验收入口见[开发状态](development-status.md)。Workspace 已接入持久提交、共享 alarm 自动交付、Preview 持久绑定和内部目标校验，Gateway 与用户服务面板已接创建/列表/详情/停止。真实 Workerd 验证保存来源、回滚、重启、策略重放、停止和内部绑定，Runtime 为 RPC 替身；Gateway 独立验证真实 Catalog 授权与公开投影，Workspace 为 RPC 替身；Chrome 界面与桌面/手机截图使用 HTTP 替身。各层证据不替代完整纵向验证。[此前原生 Docker 验收](evidence/runs/m3-native-service-20260907152331340/native-service.json)证明当时服务启停与只读输入；后续控制端口隔离修复仍须在原生 x86 容器重验，不能用旧记录证明当前 SDK 全链路或完整隔离。

## 1. 当前代码与冻结契约

实现入口为 [`declaration.ts`](../services/preview/declaration.ts) 和 [`source.ts`](../services/preview/source.ts)。项目声明路径冻结为 `app/preview.json`。原设计中的 `.riffology/project.json` 是早期拟定路径；本轮采用已有归档和工具保护边界，`.riffology` 保留平台控制，不作为项目可编辑声明目录。职责文档已按此决定收敛；其余设计引用也应以此为准，不能为兼容旧草案开放受保护目录。

声明的最小示例：

```json
{
  "schemaVersion": 1,
  "runtime": "python",
  "entrypoint": "app/server.py",
  "dependencyLock": "app/requirements.lock",
  "port": 8080,
  "healthPath": "/health",
  "observation": {
    "pagePath": "/observe",
    "statePath": "/state"
  }
}
```

`observation` 可省略。解析器只接受闭合字段集合：入口必须是 `app/` 或 `model/` 下的 `.py`，锁文件必须是 `app/` 下的 `.lock`；路径要求 NFC、受限长度且不得越界。服务端口固定为 8080，健康与观察路径仅为受限本地绝对 URL 路径，不能携带外部域名、查询串或编码绕行。声明不能配置任意 Shell 命令、环境变量、凭据、平台权限或供应商地址。

`PreviewPlanResolver` 校验明确的 source：saved-turn 使用真实 identity/Checkpoint receipt，initial-workspace 使用平台确认的初始引用及文件摘要。通过私有 RevisionStore 读取归档并验证初始检查点或保存版本，校验规范归档及完整文件包 SHA-256，再解析声明并确认入口和锁文件存在。当前上限为归档 56 MiB、声明 16 KiB、入口 1 MiB、锁文件 64 KiB；输出包含 `kind: service`、明确的 source 及声明、入口、锁文件三个摘要。文件读取来自同一归档快照。

这些输出仍是私有执行计划。生产调用方必须从 Workspace 权威状态选取已提交 receipt，并由具有 scope 校验能力的私有 Revision source 读取；不能把客户端提交的 receipt 当成已保存事实。计划中含内部身份和存储引用，对外需单独投影。锁文件目前仅校验路径、存在、大小和字节摘要，尚未校验依赖格式、来源、安装结果或运行环境兼容性。可选观察字段只声明位置，不授予观察能力。

## 2. 实现顺序与验收边界

| 阶段 | 开发内容 | 本阶段必须证明 |
| --- | --- | --- |
| M3.1 输入计划 | 接入 Workspace 已提交 head、私有 RevisionStore 与声明解析；拒绝未保存输入、缺失或损坏文件 | 跨 scope 拒绝；摘要一致；版本变化产生新计划；错误发生在分配 runtime 前。当前代码属于此阶段，仍需完整产品接线验收 |
| M3.2 service Run 与配额 | 在核心登记独立 `service` Run，固定输入 Revision、入口、锁摘要、镜像、发起 Session/Turn、幂等键、资源上限；持久租约与启动/停止对账 | 相同请求只创建一次服务；响应丢失不重复启动；Workspace 总配额覆盖 Turn 与 Preview，拒绝路径不分配实例；重启后可对账 |
| M3.3 独立服务 runtime | 从固定 Revision 恢复独立输入副本，使用平台固定启动器、受限用户、受控依赖安装和独立输出目录；提供启动、健康、日志、停止 | 实际 Python 进程可访问；输入不可写且与下一 Turn 隔离；超时、退出、资源限制、父子进程停止可观测；确认退出后才释放资源 |
| M3.4 Browser 后端与网关 | Plugin Host 登记 PreviewInstance 并关联 Run；独立访问源、用户与 Observer 分别鉴权；所有文档、资源、请求与 WebSocket 经代理；停止、替换、撤权立即生效 | 两租户互换地址、令牌、实例及版本不能访问；原始 Sandbox 端点不能绕行；已有 WebSocket 和旧观察在撤销后不可继续使用 |
| M3.5 项目状态与观察 | 机场 Starter 提供共享仿真状态及专用观察视图；Observer 记录实例、版本、generation、时间、状态 ID 和序号 | 用户操作后 Observer 读到同一服务的领域状态；只读性有副作用测试证据；普通页面不冒称用户屏幕；观察失败不回滚文件或 Run |
| M3.6 用户端与管理端 | Browser Panel、版本与健康状态、启动/停止/重试/日志；管理端通用资源、配额、故障与撤权入口 | UI 消费平台确认状态，停止对象清晰；管理员操作有权限和审计；两个不同领域项目复用同一平台外壳 |
| M3.7 本地纵向及云验收 | 真实容器、Workerd、D1/DO/R2、浏览器纵向链路；随后按部署门禁进行真实 HTTPS、云隔离和故障验证 | 用户创建或修改应用→保存→启动→交互→观察→替换→旧授权失效→停止；断线与 runtime 重建结果符合契约 |

M3.2 当前基础实现为 `SqlServiceRunJournal` 与扩展后的 `SqlTenantQuota`。前者固定输入计划、镜像 digest、时限和发起 actor，持久化一次性启动许可与停止状态；后者让同 Workspace 的 runtime 和独立 service Run 共占 Tenant 容量、按资源分别维护 generation。真实本地 SQLite/Workerd 已验证重启、重放、竞争和旧租约迁移。私有 `ServiceRunCoordinator` 已连接 journal/Quota/runtime 端口，`SqlServiceRuntimeSupervisor` 保存不可逆停止标记；实际 SQLite 加原生端口 fixture 验证对账。后续已补齐私有 DO 宿主、自动唤醒和原生 backend，分别在 Workerd 与 Docker 验证；生产 Workspace 路由、目录投影和实际 Sandbox 纵向链路尚未连接，不证明云资源释放。

M3 所需的 service Run 是 M4 通用 Run 的基础，不建立第二套 `preview-process` 调度器。实验并行、种子计划和结果发布仍按 M4 单独验收。

## 3. 平台与项目开发边界

M3.4 当前已实现 Workspace 内的持久 Preview 绑定、CAS 替换、永久撤销、访问会话及有限 HTTP 项目请求接线。原生 Sandbox 端口与云绑定尚未完成纵向验收，WebSocket 已有私有 fetch 与主动撤权本地候选，Observer 和原生应用纵向验收仍待实现；用户 Preview 入口已接入本地工作台，仍须真实运行端纵向验收。当前进度与后续顺序如下：

1. 已从 `gateway/index.ts` 的真实 Better Auth `getSession` 结果取得服务器 session id 和过期时间，作为私有访问上下文。`requirePreviewSession` 用一次主数据库 JOIN 复核该登录、authVersion、成员权限及 ready Workspace generation，并在查询返回后再次检查过期。真实本地 Better Auth 测试覆盖退出登录与独立第二会话；这一步尚未构成公开 Preview 授权入口。session id、token 不进入公开响应。
2. 已实现 Workspace 私有 browser 票据签发与一次兑换，固定主体、服务器 session、Workspace、Preview/runtime/source 和最长 30 秒截止，票据与 nonce 仅保存摘要。并发兑换和确认丢失均不能产生第二次成功。新增最多 5 分钟的访问会话，每次查询复核登录和目标，读取不续期；关闭门禁仍可撤销。独立源 nonce/访问 Cookie 的引导处理器已实现，已接入 Gateway 主机路由和控制端 API 候选，服务面板已有本地候选，云部署仍待完成。Observer 使用独立用途和权限上下文，不能复用 browser 票据。
3. 接入退出登录、会话过期、成员撤销、用户 authVersion 变化、Preview 替换和 Run 停止的失效路径。当前 WebSocket 由 Workspace/Runtime DO 持有，每消息与空闲周期复核持久会话、authVersion、ACL、绑定、Run 和租约；D1 删除会话后的空闲关闭已在本地 Workerd 验证。真实 Google 登出、浏览器 WS、原生容器和部署重建断连仍须验收，开关默认关闭。
4. 配置独立 HTTPS 源并实现受控 HTTP/子资源/应用交互/WS 转发，过滤平台 Cookie、Authorization、代理控制头及项目响应中的平台安全策略覆盖。M0 的固定路径和只读合成应用不足以覆盖真实模型交互；保留其历史证据，不将其 synthetic tenant/session 迁入生产。
5. 已将公开 Preview 状态与访问入口接回当前服务面板；继续连接 Observer 收据和项目只读观察契约。最终以真实身份、实际容器和浏览器重新验收停止、替换、撤权及恢复；本地绑定或分层替身测试不能代替整体验收。

当前控制端候选新增 `GET /api/workspaces/:id/previews`（只读恢复）、`POST /api/workspaces/:id/previews`（runId、expectedPreviewId、幂等键）和 `POST /api/workspaces/:id/previews/:previewId/tickets`（nonce）。主体和 scope 来自真实登录与 Catalog，不能由 body 指定。`0008_preview_routes.sql` 保存不可变 Preview → Workspace/generation/期限及摘要主机标签，Gateway 仅识别平台配置的独立 HTTPS 基域中的已注册标签；查到路由仍不授予访问。启用前须先部署迁移、配置 `M3_PREVIEW_ORIGIN`、验证 DNS/证书和控制页 iframe CSP，并完成含服务面板的原生应用代理纵向验证。当前未应用云迁移或启用开关。

恢复 GET 返回白名单 current 与 available：current 保留当前绑定 ID、Run ID、期限与撤销时间，供刷新后的 CAS 替换；仅有效 Run/绑定且已有注册路由时返回 available 引导入口。读取不创建绑定或注册路由，未知运行端错误返回失败，不伪装为空状态。用户端打开操作必须冻结幂等键、runId 与 expectedPreviewId，未知结果按原请求重试；409 后重新读取状态。票据仅在精确 iframe 窗口与独立源之间交接，不进入本地存储或 URL。关闭面板仅移除浏览器视图，不能隐式停止独立 Run。

非控制源请求现在经专用 Preview host 分支处理，严格检查完整 origin、注册记录和当前 Run/绑定，再接保留的 bootstrap/exchange 路径。兑换强制匹配主机对应 previewId。项目根路径与其他有限 HTTP 请求现已读取 access Cookie，经 fresh authorize 后进入 `Workspace.forwardPreviewHttp`，再交给 `ServiceRuntime`。Workspace 从权威 Run 构造固定 spec、reference 与 lease，不接受客户端执行参数；Runtime 再检查 dispatched 租约、停止栅栏和运行截止。此接线尚不证明原生容器中的项目 Preview 已可用。

当前 `authorizedPreviewHttp` 在上传分段读取前后、转发前、响应头返回前和每次响应分段读取前后复核访问权限。请求总期限最多 15 秒，并受访问授权截止约束；取消、过期或拒绝会终止等待和后续转发。上传最多 1 MiB、读取最多 5 秒，响应最多 8 MiB。已经发送给用户的字节无法撤回；此有限 HTTP 检查不能替代 WebSocket 撤权机制。2026-09-08 对已安装 Sandbox SDK 0.12.9 的只读检查确认：公共 `containerFetch` 会自动启动容器，不能直接用于停止后禁止重启的 Preview；`fetchPreviewIfRunning` 是 SDK 私有方法，也不能依赖其私有调用。下一步须验证 Sandbox 子类通过平台已运行容器的固定 8080 端口转发能力，不创建新运行、不暴露 Sandbox URL/token，剥离平台凭据和控制头；WS 代理须持有可撤销连接。此调查没有启动容器或联网，不替代实际转发验收。

2026-09-08 本地浏览器纵向验证：真实 Chrome 用户面板经生产 Gateway、Preview host、Workspace 与票据存储，完成打开、nonce 引导、票据签发/兑换、Host-only HttpOnly Cookie 和项目 HTTP 访问。刷新从 GET 恢复，不增加绑定 POST 或 Runtime 启动次数；删除本地 D1 登录会话后，旧 Cookie 请求返回 403 且不再调用 Runtime。ServiceRun/Quota/RevisionStore 及 D1/R2 使用真实本地实现，服务器身份返回值、控制页静态外壳和 Runtime HTML/JSON 是显式测试夹具。测试不经过真实 Google OAuth、原生容器或公共 DNS/TLS，因此这些门禁仍须分别完成。

平台拥有 Run 和 Preview ID、租户授权、镜像与启动器、配额、健康判定、停止证明、访问会话、观察收据和审计。项目内 Pi Agent 编写 `app/preview.json`、Python 应用、仿真模型及依赖声明；这些文件只能作为待验证输入，不能修改平台插件注册、访问策略或预算。

Preview 必须使用独立 service runtime。当前 Turn 容器会在保存时封存，不能把同一容器改为长驻服务，也不能让 Preview 抢写 Agent 正在编辑的 Workspace。服务的输入副本只读，缓存和结果进入受限输出目录；成果发布另走平台验证链路。

项目应用持有 `simulation_state_id`、状态序号与仿真时钟。暂停仿真后服务仍可健康；关闭 Panel 不停止服务；取消 Agent Turn 不等同于停止独立 Run。服务重建形成新的实例身份并使旧观察失效，首版不承诺恢复任意 Python 内存时刻。

## 4. 开发过程模拟、风险与措施

| 场景与风险 | 应对实现 | 验收方法 |
| --- | --- | --- |
| Agent 写完入口但未保存，启动命中了可变目录 | 先完成保存，再由权威 head 固定 receipt；准备失败不创建 runtime | 写后未保存、并发下一 Turn、旧版本启动分别核验字节摘要 |
| 声明合法但依赖锁不可安装或藏有任意来源 | 定义受控锁格式与来源策略，固定镜像和安装器；禁止把声明拼成 Shell 命令 | 恶意参数、外部引用、无匹配包及安装超时失败，不能报告 ready |
| 开始请求或云响应丢失导致双进程、双配额 | 持久启动 fence 与唯一 effect identity；未知时观察原实例，不盲目重试 | 注入启动前后响应丢失、DO 重建，实际进程与占用各保持一次 |
| 浏览器关闭引发服务误停，或孤儿服务持续计费 | 平台租约独立于连接；到期与停止通过持久对账确认；设定最大运行时长 | 断线继续运行、租约到期停止、停止未知期间不虚报资源已释放 |
| 项目进程读到平台凭据或改写输入 | 独立运行身份和挂载；平台控制文件不可写，输入只读；输出与网络按策略限制 | 真实容器读取、写入、进程逃逸及网络拒绝测试；不以 mock 代替隔离证明 |
| 首页鉴权但静态资源或 WebSocket 泄漏 | 代理覆盖每种请求及连接；授权绑定主体、Workspace、实例、版本与期限 | 两用户重放子资源/WS、退出登录、成员撤销、实例替换后的旧连接测试 |
| 随机源 URL 被直接分享 | 源服务验证内部授权或彻底关闭绕行路径；用户不获得可绕行源凭据 | 直接访问底层 URL、伪造内部请求、重放旧授权均拒绝 |
| GET 页面加载本身修改领域状态 | 单独定义观察视图及状态读取契约，限制导航与网络；比较观察前后状态与审计 | 无点击加载、刷新、截图、多次状态读取均不推进仿真或触发业务写操作 |
| 替换后旧截图被描述为当前结果 | 收据固定实例、Revision、generation 和时间；返回前检查当前绑定 | 并发替换/观察、过期缓存命中时拒绝旧证据 |
| 健康检查成功被误称为仿真正确 | 平台健康只证明服务就绪；领域测试由模型和 Starter 验收承担 | 分别记录 HTTP 健康、交互、状态一致性与模型正确性证据 |
| 服务日志、归档或输出无限增长 | 有界日志、输出配额、背压与生命周期保留策略；活跃 Run 引用 Revision | 超限、分页、停止和重建测试；未定义安全引用释放前不自动删除输入 |

## 5. UI 验收要求

用户端 Browser 外壳显示项目应用标题、已保存版本、服务状态、健康与错误、观察时间及观察失效原因。启动时显示平台确认的 `starting`，健康检查通过后才显示 `running`；停止期间保持 `stopping`，等待退出证明。日志与重试指向具体 Run，不能用前端布尔值伪造运行事实。

领域参数、动画、图表和“暂停仿真”留在嵌入的项目应用中。平台只提供通用服务控制和来源信息。管理员管理资源占用、配额、服务失败、插件禁用及撤权，不编辑领域控制台；每项管理变更由服务端授权并追加审计。

至少以机场 Starter 和一个非机场小应用验证平台外壳通用性。移动端、Panel 关闭再打开、刷新恢复、网络断开、观察降级和服务替换分别执行真实浏览器测试。

## 6. 验证与部署顺序

1. 本地契约与故障矩阵覆盖声明、归档、身份、版本、限额和状态机；单元测试不能作为真实进程或云访问证据。
2. 私有 RevisionStore 在真实 Workerd/R2 中验证源解析、重启及跨 scope 拒绝；产品 Workspace 路由证明输入来自已提交 head。
3. 本地真实服务容器验证输入恢复、依赖安装、启动健康、输出隔离、停止及重建；无模型 fixture 验证全链路，记录外部模型派发为零。
4. 实际浏览器验证 iframe、HTTP 子资源、WebSocket、身份切换和观察状态；独立记录平台行为与项目领域行为。
5. 每个验收运行写入新的 `docs/evidence/runs/<run-id>/`，记录源码摘要、环境、命令、结果、失败及清理情况；旧失败记录保留。完整检查源码稳定后再更新开发状态。
6. 云部署前冻结迁移、bindings、镜像摘要、回滚/禁用方案、域名与证书、配额、预算及测试身份。已有域名 `riff-demo.gaojihe.cn` 需按实际 DNS 和证书条件验证 Preview 独立源，不能从已存在主应用推断通配 HTTPS 已可用。
7. 仅在部署门禁满足后执行云迁移和发布，再验收真实两租户、云 VM 停止与重建、原始端点防绕行、现存 WebSocket 撤销和资源计量。真实供应商建模闭环需要单独确认当次模型预算与授权，不因本地 fixture 通过自动调用。

本计划不要求恢复已退役的 `riffology-demo` Worker 或旧路由。源码候选、本地通过、云部署与真实模型验收分别报告；未完成相应证据之前，M3 和供应商执行门禁保持关闭。

## 用户服务入口（本地实现，完整纵向验收待完成）

已新增独立 Service API，不把服务运行混入 Agent Turn。创建使用 `POST /api/workspaces/:workspaceId/services`，输入仅为 `Idempotency-Key` 与严格 JSON `{maxDurationMs}`；读取和停止分别使用 `GET /api/workspaces/:workspaceId/services/:runId` 与 `POST .../:runId/stop`，停止 body 为 `{}`。`GET /api/workspaces/:workspaceId/services` 提供有界列表，默认 20、最大 50 条；后续页传入返回游标的 `before_created_at` 与 `before_run_id`。列表按创建时间与 runId 降序读取；生产静态工作台已消费这些入口，支持刷新恢复、分页、详情与启动/停止。浏览器验收使用 HTTP 替身，完整真实 Gateway→容器→UI 路径仍需验证。

每次请求重新执行服务器身份、Admission 和 Catalog ownership 校验。创建要求 ready；读取和停止使用 `ProjectCatalog.maintenanceWorkspace()`，与普通入口共享租户、成员、authVersion、项目关联和权威 generation 校验，但不要求 Workspace 仍 ready。关闭新建门禁同样不关闭查询和清理。

客户端不能指定 scope、actor、generation、Revision、镜像、命令、环境或 Preview URL。`submitServiceRequest` 经 journal 的 `createFromPolicy` 将用户时限与平台镜像分开：镜像仅首次验证和冻结，同键重放匹配 actor 与用户时限并返回原记录，不因配置升级产生第二次运行。原私有 `submitService` 仍保持严格镜像输入匹配；两入口共享唯一意图表。同键不同用户输入返回 409；首次提交及同键重放均返回 202 和同一 runId。

公开响应按白名单提供 `runId`、`kind`、`deliveryStatus`、`runStatus`、时间和公开错误码。创建、停止及列表只投影意图，`runStatus` 为 null，不能据此推断进程未运行。详情由 Workspace 根据持久 task 查询 ServiceRun，验证 id/scope/actor/配置、时间与状态组合，并限时等待，超时返回通用不可用错误，迟到响应释放。交付状态 `delivered` 不等于运行状态 `running`，停止转交不等于进程停止。完整 source、task、spec、actor、authVersion、requestKey、内部对象路径、租约与 dispatch 标识不直接返回。Preview 网关完成前不生成可访问 URL。

验收需覆盖跨租户拒绝且零私有调用、Origin 与严格输入、同键冲突、并发及丢失响应、版本和镜像变化后的重放、未交付取消、未知交付停止、门禁关闭及 Workspace 非 ready 时的查询/停止、列表刷新恢复。RPC 超时只表示未确认，不能据此报告 stopped 或释放配额。

当前本地基础回归证据：[完整检查](evidence/runs/m0-local-20260907141820176/local-checks.json)，源码稳定，M0 350 pass / 1 skip、M1 180 pass、M2 354 pass、M3 9 pass。包含私有 Workerd/R2 解析，但尚不覆盖表中服务运行、产品接线和云验收。

独立 service Run 与共享配额基础的后续证据：[完整回归](evidence/runs/m0-local-20260907142957703/local-checks.json)，源码稳定，907 pass / 1 skip；M3 含 23 项本地测试。运行边界见 [Service Run 契约](m3-service-run-contract.md)。尚未接通生产协调器或真实 service runtime。

协调与 supervisor 基础证据：[完整回归](evidence/runs/m0-local-20260907144158690/local-checks.json)，源码稳定，930 pass / 1 skip，M3 46 项。本地原生端口仍为 fixture，实际进程和生产接线未验收。

M3.3 已新增原生适配器、分块传输及 root 运行程序，并启动本地 Docker 验证；固定 JSON 依赖锁、只读输入、UID 10001 与停止证明的边界见 [原生契约](m3-service-run-contract.md)。生产协调器到实际 Sandbox 的接线、自动到期停止、输出总配额及 Preview 网关仍待完成。

原生本地证据：[Docker 验收](evidence/runs/m3-native-service-20260907145738276/native-service.json)与[完整回归](evidence/runs/m0-local-20260907145738314/local-checks.json)，均源码稳定；934 pass / 1 skip。原生进程已运行，但生产 Workspace/Sandbox/网关/UI 全链路与云门禁尚未完成。

M3.2 持久调度宿主已增加：ServiceRun DO 固定任务与首次 alarm 原子保存，支持重启补建 journal、到期对账、停止与配额清理。真实 Workerd 验证自动到期流程，但 Runtime 仍为测试替身；生产 bindings、Runtime DO 到实际 Sandbox 及 Workspace/Gateway 接线未完成。

私有 `ServiceRuntime` 已连接 RevisionStore 的纯归档接口、TenantQuota 和原生适配器，真实 Workerd 验证租约/身份拒绝、重放、重启和门禁关闭后的清理。主控核查发现锁定 SDK 不转发 exec stdin，已改为 root 私有分块文件加固定读取命令；旧 Docker 替身支持 stdin 的结果不能证明 SDK 兼容。下一步需要实际 Sandbox SDK 的本地纵向验证与部署配置预检，再连接 Workspace 权威 head 和产品 API，随后按 M3.4 推进访问网关。


2026-09-08 更新：控制端口隔离成为当前执行发布前置条件，详见 [控制端口契约](m3-service-run-contract.md)及 [开发状态](development-status.md)。真实 SDK 分块传输已执行，但 Mac ARM/x86 仿真环境无法加载项目 seccomp；完整服务验收失败，不能沿用此前 Docker 通过记录宣称当前镜像可运行。原生 x86 Linux 的内核防护验证已通过，实际 SDK+原生 x86 容器验收仍待完成。Workspace 权威 head 与 Run 产品入口可继续独立开发，执行开关保持关闭。


### Workspace → Run 下一步接线约束

- Gateway 从当前主体和 Workspace 权限导出 scope/actor；客户端不得提供内部 receipt、身份、镜像或租约。新建门禁与查询/停止分离。
- Workspace 用主体与请求键持久化唯一运行意图，固定 runId、原始请求、平台镜像及限额。在同一 SQL 事务中读取权威已保存 head 并冻结来源，解析和 RPC 在事务外执行。重放不得重新读取新 head。
- 输入来源必须完整支持 `saved-turn` 与 `initial-workspace`：官方模型初始归档不伪装成 Turn receipt，也不通过调用模型补出一个版本。扩展 Preview 源契约后由 Runtime 按对应来源再次验证。
- 解析结果持久保存为不可变任务，经现有 ServiceRun.accept 交付。丢失确认复用同一任务；未交付请求借用 Workspace 共享 alarm 重送，租约、健康、停止仍归 ServiceRun 管理，不建立第二套调度器。
- 停止覆盖未派发、派发未知和已派发状态。未知交付不以远端暂无记录为成功取消证明；列表是投影，不把 accept 当作 running，也不对外返回原始 task/lease。
- 真实 Workerd 产品接线验收覆盖并发幂等、head 变化、解析与交付中断、停止竞态、门禁关闭后清理、跨 Workspace 拒绝，以及两类输入来源。其结果与实际 Sandbox 镜像验收分别报告。


2026-09-08 双来源实现：Preview、Run/Runtime 与 Native 已统一使用 source 判别联合，RevisionStore 对初始来源复核真实 R2 模型包和检查点；Workspace 私有 previewPlan 从自己的已保存 head 或初始化状态选择来源。同步 workspaceRevisionSnapshot 已提供给后续意图事务使用。当前是权威来源读取接线，不包含持久提交意图、Gateway 创建入口、Run 自动交付或初始项目 Preview UI；后续继续执行上一节约束，不能以来源解析成功代替服务启动完成。


2026-09-08 持久请求基础：意图 journal 已冻结来源与 runId，覆盖未知交付和停止转交；共享 alarm 已支持第三 service 逻辑截止，并通过真实 SQLite/Workerd 验证。当前 [完整回归](evidence/runs/m0-local-20260908071621369/local-checks.json)为 956 pass / 1 skip。下一步把 journal、首次唤醒和交付 handler 接入 Workspace，再连接 Gateway 与 UI；这些基础本身不会创建远端 ServiceRun。


2026-09-08 交付恢复基础：ServiceIntentDelivery 与 Host.acceptStopped 已实现，分别通过真实 SQLite 和 Workerd 验证取消竞态、确认丢失及恢复。[完整回归](evidence/runs/m0-local-20260908072102293/local-checks.json)为 963 pass / 1 skip。下一步将这些对象接入 Workspace 的提交、停止与共享 alarm 路由，确保首次唤醒不丢失，再完成 Gateway 与 UI；解析失败重试受固定投递截止约束，产品接线还应明确永久输入错误的及时失败反馈。

2026-09-08 WS 接线：普通 RPC 不能序列化 WebSocket，已改用私有 fetch。当前连接策略和限制见[服务契约](m3-service-run-contract.md)的 WebSocket 章节。新增真实 Chrome 经回环 TLS 适配器至 Gateway/Workspace 的网络验证，通过同源 wss、异源 CSP 拒绝、文本/二进制及登录撤销关闭；身份和项目 Runtime 为夹具。继续验证原生 Python 服务、云入口、部署重建与鉴权负载，再决定开启 M3_PREVIEW_WS_ENABLED。Observer 仍须独立用途与权限，不得复用 browser access Cookie。
