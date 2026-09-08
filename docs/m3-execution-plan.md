# M3 Browser Preview 开发与部署执行计划

更新：2026-09-07。目标是让用户与 Agent 在同一个已保存版本、同一个 Preview 服务实例上观察和修改仿真；平台负责服务生命周期、权限和资源，项目应用负责领域状态与交互。

本计划依据[系统设计](mvp-system-design.md)和[平台与项目职责](platform-project-boundary.md)。**当前已实现 Preview 声明、保存版本解析、service Run/共享配额、持久调度与 Runtime DO，以及通过 Docker 验证的原生启动器。尚未打通实际 Sandbox SDK、Workspace、Preview 网关和 UI 的完整产品链路，M3 未交付。** 源文件摘要不证明 Python 可运行、依赖已安装、服务健康或观察无副作用。后续每阶段均须留下与实际执行范围相符的独立验收记录。

[当前完整本地检查](evidence/runs/m0-local-20260907152330177/local-checks.json)通过且源码摘要稳定：M0 350 项通过、1 项跳过，M1 180 项、M2 354 项、M3 55 项通过，合计 939 项通过。[原生 Docker 验收](evidence/runs/m3-native-service-20260907152331340/native-service.json)独立证明真实服务启停与只读输入。Workerd 验证私有 DO 和存储接线，Sandbox 仍为 RPC 替身；两者不等于实际 SDK 全链路或云验收。

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

`PreviewPlanResolver` 校验 identity 和 Checkpoint receipt，通过注入的 Revision source 读取归档，校验规范归档及完整文件包 SHA-256，再解析声明并确认入口和锁文件存在。当前上限为归档 56 MiB、声明 16 KiB、入口 1 MiB、锁文件 64 KiB；输出包含 `kind: service`、输入身份、Revision 收据及声明、入口、锁文件三个摘要。文件读取来自同一归档快照。

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

当前本地基础回归证据：[完整检查](evidence/runs/m0-local-20260907141820176/local-checks.json)，源码稳定，M0 350 pass / 1 skip、M1 180 pass、M2 354 pass、M3 9 pass。包含私有 Workerd/R2 解析，但尚不覆盖表中服务运行、产品接线和云验收。

独立 service Run 与共享配额基础的后续证据：[完整回归](evidence/runs/m0-local-20260907142957703/local-checks.json)，源码稳定，907 pass / 1 skip；M3 含 23 项本地测试。运行边界见 [Service Run 契约](m3-service-run-contract.md)。尚未接通生产协调器或真实 service runtime。

协调与 supervisor 基础证据：[完整回归](evidence/runs/m0-local-20260907144158690/local-checks.json)，源码稳定，930 pass / 1 skip，M3 46 项。本地原生端口仍为 fixture，实际进程和生产接线未验收。

M3.3 已新增原生适配器、分块传输及 root 运行程序，并启动本地 Docker 验证；固定 JSON 依赖锁、只读输入、UID 10001 与停止证明的边界见 [原生契约](m3-service-run-contract.md)。生产协调器到实际 Sandbox 的接线、自动到期停止、输出总配额及 Preview 网关仍待完成。

原生本地证据：[Docker 验收](evidence/runs/m3-native-service-20260907145738276/native-service.json)与[完整回归](evidence/runs/m0-local-20260907145738314/local-checks.json)，均源码稳定；934 pass / 1 skip。原生进程已运行，但生产 Workspace/Sandbox/网关/UI 全链路与云门禁尚未完成。

M3.2 持久调度宿主已增加：ServiceRun DO 固定任务与首次 alarm 原子保存，支持重启补建 journal、到期对账、停止与配额清理。真实 Workerd 验证自动到期流程，但 Runtime 仍为测试替身；生产 bindings、Runtime DO 到实际 Sandbox 及 Workspace/Gateway 接线未完成。

私有 `ServiceRuntime` 已连接 RevisionStore 的纯归档接口、TenantQuota 和原生适配器，真实 Workerd 验证租约/身份拒绝、重放、重启和门禁关闭后的清理。主控核查发现锁定 SDK 不转发 exec stdin，已改为 root 私有分块文件加固定读取命令；旧 Docker 替身支持 stdin 的结果不能证明 SDK 兼容。下一步需要实际 Sandbox SDK 的本地纵向验证与部署配置预检，再连接 Workspace 权威 head 和产品 API，随后按 M3.4 推进访问网关。
