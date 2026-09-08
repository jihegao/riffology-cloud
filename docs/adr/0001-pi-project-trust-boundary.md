# ADR 0001：可信 Pi 与项目执行分开部署

日期：2026-09-05。状态：采用分离执行域的实现方向；云端 G0 验证尚未完成。

## 决策

Pi 宿主、权威 Session 和控制凭据属于平台。项目代码、依赖安装、仿真与 Preview 属于不可信项目执行域。两者使用不同 VM / 受验证的独立执行信任域，通过鉴权的远程工具桥通信。平台不依赖同一 VM 中的 cwd、文件权限、环境变量命名或不同 Shell Session 来隔离两者。

此决策采用单一 Cloudflare 平台与单一 Pi SDK，不引入多云或多 Agent 产品框架。可信宿主不会挂载项目目录；发送给模型的项目文件内容来自受项目范围约束的工具结果。

## 依据与风险

1. Cloudflare Sandbox 文档定义的隔离边界是 Sandbox 实例；同一 Sandbox 内的会话共享文件系统、进程与 localhost。现有同 VM 候选方案没有证明项目 Shell 无法接触控制服务。[Sandbox 安全说明](https://developers.cloudflare.com/sandbox/concepts/security/)
2. Pi 0.85.0 的默认 SDK 路径会创建文件 SettingsManager、ResourceLoader 与全局模型/凭据运行时；项目扩展的加载是执行代码，不能依靠提示词防止它获得宿主权限。[Pi SDK](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/sdk.md)
3. 本地锁定包 `@earendil-works/pi-coding-agent@0.85.0` 的 `dist/index.js` 导出 `experimental/server.js`，后者引用未在包依赖中声明的 `@earendil-works/pi-server`。本项目显式锁定安装 `@earendil-works/pi-server@0.85.0` 后 import 可用。这是上游发行完整性问题，应保留导入检查，升级时重新验证。

以上说明为何选择较强边界，不能代替云端攻击探针或声明已验证云隔离漏洞。

## 执行边界

```text
浏览器 → 鉴权 Gateway → Workspace 协调器
                         │
             ┌───────────┴───────────┐
             │                       │
       可信 Pi 宿主              项目 Sandbox
       固定 ResourceLoader        项目 Shell / Python / Preview
       私有 Session 内存          用户代码与依赖
       受控模型运行时             无权威 Session / 供应商密钥
             │                       ▲
             └→ 工具桥 → 校验权限 ────┘
```

平台供应商密钥保留在 Worker / 秘密存储，可信 Pi 只接收本回合范围内的代理凭据。M0 本地真实供应商探针可由主控注入明确授权的凭据；此便利不成为生产密钥落盘或注入项目 VM 的依据。

项目可能完全控制自己 VM 内 SDK HTTP/RPC 接口。平台因此必须将这些响应视为项目提供的数据，且不能把该接口的访问能力当作平台授权。它不得获得跨项目/租户寻址、R2 任意对象访问、配额调整、账本写入或可信 Pi 控制权。

工具桥校验 tenant/project/session/turn、command ID、generation、deadline 和允许操作，并使用服务端已绑定身份进行寻址。项目结果无法更改这些字段。`generation` 失效、重复命令和已取消回合的处理由协调器的权威状态决定。项目 VM 接收的任何下载/上传能力都必须限定对象、方向、大小与有效期；它不能持有 R2 主密钥。

## 已实现的宿主约束

入口：`services/runtime/controlled-pi.mjs` 的 `createControlledPiSession()`。

- `ControlledResourceLoader` 直接实现 Pi 公共接口，不实例化 DefaultResourceLoader；首次启动与 reload 均不发现项目 `.pi/extensions`、`.pi/skills`、`.agents/skills`、AGENTS、SYSTEM、prompt、theme、模型或设置。
- 固定 Skill 通过平台显式传入的名称与内容加入系统提示，未暴露 `/skill:` 文件展开能力。普通用户消息按数据输入。
- SettingsManager 和 SessionManager 均在内存创建；恢复接受协调器注入的 checkpoint 数据，不打开项目或全局 Session 路径。
- 模型运行时设置 `modelsPath:null`，注入只读凭据来源，关闭网络目录刷新；每个请求重新要求显式注入凭据并限制模型清单。凭据缺失时失败，不回退宿主环境变量。
- 工具默认空。平台只注册 `project_*` 远程工具，模型的调用进入平台提供的桥函数；不开放本地 read/bash/edit/write。产品只获得受控 facade，无法访问原始 AgentSession 的 `executeBash()`、模型变更或 Session 文件 API。
- 每次恢复验证 checkpoint 格式、tenant/project/session 绑定、entry 图、所有历史模型与工具引用。未知或已撤销项会显式拒绝；恢复不执行历史工具。
- 禁用自动供应商重试和自动压缩，避免 M0 宿主产生未由回合策略管理的附加调用。活动回合不能导出 checkpoint；取消结束后可导出。
- `prompt()` 显式返回 `completed`、`aborted` 或 `failed`；供应商返回错误时不会被误当作成功完成。调用前的配置/鉴权失败仍抛出异常，协调器必须处理两种失败路径。
- 每回合建立宿主 AbortController，贯穿凭据解析、checkAuth 和模型流；不遵守 signal 的凭据来源在取消后晚完成/晚失败，也不能继续发送 HTTP 请求。`dispose()` 先关闭入口，再取消。取消等待上限由 `cancellationGraceMs` 控制，默认 5 秒；工具不响应取消而超限时，宿主关闭并明确要求 supervisor 终止执行域，活动 Session 不能保存或复用。

这段代码是可信宿主适配器，不承担用户鉴权、远程桥 ACL、持久回合、R2 提交原子性或云基础设施隔离职责。

## 验证与证据范围

执行 `node --test --test-timeout=15000 tests/m0/pi/*.test.mjs`。当前 15 个测试通过，使用真实 Pi 0.85.0 SDK 与本机 HTTP/SSE 协议 fixture，验证恶意资源不加载、模型/工具白名单、远程工具传参和恢复不重放、跨项目 checkpoint 拒绝、流式取消、无凭据拒绝、凭据预检取消竞态、非协作工具关闭，以及探针证据口径。fixture 的回复与 token usage 均为测试数据，不是真实 LLM 结果或付费证据。

`scripts/m0/pi-live-probe.mjs` 默认不发请求；只有 `--live` 与 `RIFFOLOGY_PI_PROBE_LIVE=1` 同时存在才进行有界真实调用。主控通过 `RIFFOLOGY_PI_PROVIDER`、`RIFFOLOGY_PI_MODEL`、`RIFFOLOGY_PI_API_KEY` 及可选 `RIFFOLOGY_PI_BASE_URL` / `RIFFOLOGY_PI_API` 注入设置。输出只有事件种类、用量、供应商请求 ID、上下文恢复判断，不能输出凭据。`--cancel` 增加取消探针。

## 首次真实调用记录的口径补充

主控已采集 `docs/evidence/runs/m0-initial/artifacts/pi-live.json`：`opencode-go/deepseek-v4-flash` 两次正常回复验证 Session 上下文恢复，第三次观察到 `aborted`，三个 HTTP 状态均为 200。此原始 artifact 保留不改写，以下修正应随证据一起阅读：

- 原输出 `usage.cost` 全为 0，来源是探针尚未配置正式价格、使用 SDK 占位 rate；它不能证明免费或实际费用为零。账务金额应解释为 `null`，pricebook 未配置。取消回复的已观察 usage 也不是最终账务用量，需标记 `not-final` 并等待供应商对账。
- 三个 header request ID 均为 `null`，该记录不能证明供应商请求关联已完成。Pi 0.85.0 的 `AssistantMessage` 公共字段包含 `responseId`；锁定包 `pi-ai/dist/api/openai-completions.js` 将流式 `chunk.id` 写入该字段。响应 ID 与 HTTP request ID 是不同字段，新的脚本分别记录，不能将前者改名为后者。本地协议测试已确认 SDK 保留响应 ID；首次 live artifact 没有采集它，无法凭空补录。
- 更新后的脚本输出 `responseCorrelation.available/unavailable`、`cancelCasePass` 与明确的金额未知状态；要求 `--cancel` 却未实际观察到 `aborted` 时整体失败，关联字段缺失时只得到 `partial-correlation-unavailable`。金额字段不再使用 SDK 的占位 `cost`。
- 上述字段修订和预检取消竞态修复之后只运行了本地 fixture 测试，没有额外发送真实供应商请求。不能将先前真实调用视为修订后代码的重新验收。

## 仍须通过的 G0 条件

- **G0-T01**：在实际可信宿主/模型代理链路验证真实流式调用、请求关联 ID、取消和 Session 恢复。本地通过仅覆盖其子集。
- **G0-T02**：从项目 VM 尝试读取可信宿主文件、`/proc` 环境、Session、发送信号和访问控制 HTTP/RPC/IPC；再尝试利用自身 SDK 控制 API 跨范围访问。敏感读取及越权控制均需有拒绝证据。
- **G0-T03**：把同样的恶意资源 fixture 放入云项目，启动与恢复可信 Pi，确认资源、模型和工具仍符合平台白名单。
- **G0-T04–T09**：在分离拓扑重新验证双租户、20 CRUD 与恢复、保存失败、Preview 全路径鉴权、断线/kill/旧 generation 和出站网络能力。

只有上述云端证据完成并经主控检查，才能关闭信任边界 gate；本 ADR 和本地测试不能将 G0 状态直接改为通过。
