# #214 通用页面本地候选与生产阻碍

2026-10-15；与 #85 同一隔离工作树，基线 main `fbc0e46`。仅实现及验证快照；Issue/Linear 仍是排期入口。未推送、合并、部署、修改凭据或运行付费线上模型。

上述状态和下文测试数字保留自原作者历史阶段报告，不代表本轮发布状态。历史检查尚未按当前最终冻结源码独立复核；本轮 SHA、文件清单、命令、实际退出码及 skip 待集成负责人记录，不以历史“完整 check 退出 0”签收当前候选。

## 本地能力

复用 canonical immutable Workspace Revision、RevisionStore、Catalog 授权、现有 Model 导航和既有独立 browser execution origin。无需 Python ModelSpec/trace，不进入旧仿真语法 validator，不申请云端运行 lease。通过 `app/views.json` 声明固定资产闭包和多个页面：

```json
{
  "schema": "project.views/v1",
  "files": ["app/home.html", "app/main.mjs", "app/style.css", "app/pixel.svg", "docs/data.json"],
  "views": [{"id": "home", "title": "Dashboard", "entrypoint": "app/home.html"}]
}
```

资产最多 64 份，单份 256 KiB，正文总量 2 MiB；host 再核对交付包及逐文件摘要和总量。HTML、JavaScript modules、CSS、媒体及显式数据文件都有不可变摘要，包同时绑定 tenant/project/workspace/generation、Revision ID 和整个 archive SHA256。模块引用经 Acorn 解析，映射为包内精确 import map；CDN、隐式安装、未声明资源和计算式 dynamic import 拒绝。模块循环由浏览器模块图处理；CSS 递归引用失败，不无限展开。

固定 frame 从既有独立执行站点交付；`sandbox="allow-scripts"` 不含 allow-same-origin。DOM 只存在于该 opaque frame。交付拒绝 Cookie/Authorization/query，页面无主站凭据；CSP 拒绝 fetch、子 Worker、子 frame、表单提交及非包资产加载。以上不构成完整浏览器网络隔离，见下文阻碍。

## 只读 broker 与 UI

host 在私有 MessagePort 闭包中绑定当前 frame/package/view/generation，不接受页面自报 scope 或任意 app API URL。消息仅包含有界 files.list、files.read、artifacts.list、updates.subscribe、updates.cancel 和包内 navigate。每次数据读取先请求可信父页面重新确认当前服务端权限与包身份；Gateway 和 Workspace 在 await 后复核授权、scope 和最新 Revision。旧 generation、跨项目路径、额外 scope 字段、写动作及迟到结果拒绝。

订阅现已接入既有 ToolArtifactStore 的真实 R2 只读投影：成功 read/list/search 工具结果中，大于 16 KiB、至多 1088 KiB 的 JSON Artifact。列表最多 32 项，游标同时绑定完整 scope、Store 版本与 journal 可见收据摘要；分页间提交或退休会使旧游标失效，调用方从首页重试。Store 的保留引用先于 journal append，故 Workspace 额外验证实际已提交事件或 replay receipt，未提交引用不能交付。读取只接受 artifactId 与字节 offset，服务端依据私有 identity 派生对象键，验证完整 R2 大小/摘要后每次返回最多 16 KiB 的 base64 块、整件收据及 nextOffset。页面不能选择对象键或发起工具运行。

`riffoid.listArtifacts(cursor=null)` 返回 `{items,nextCursor,version}`；`riffoid.readArtifact(artifactId,offset=0)` 返回 `{receipt,offset,base64,nextOffset}`。订阅快照包含 Artifact 第一页及其下一页游标，页面定义另列于 views；host 每 5 秒轮询保存状态。订阅取消在任何 await 前推进独立 epoch，等待中的授权、初始列表和 publish 都不能在取消后复活；关闭或切换也丢弃迟到响应。Gateway 与 Workspace 在等待后复核当前 owner、generation 与页面包摘要。

只读投影未扩大到 Observer、simulation、publication 等有独立授权语义的存储，也不包含小型内联工具结果；不将这一 Tool Artifact 投影声称为全桶清单或全部 R2 数据。当前 #214 明确将 #218 的只读 Observer 后置，未通过本轮投影提前开放。消息最多 4 KiB，最多 8 个在途请求，回复最多 64 KiB，单次包内文本读取最多 32 KiB；这些是协议界限，不是浏览器硬内存隔离保证。

页面按保存版本展示，响应式 iframe 宽度 100%；页面选择按 tenant/workspace 保存于浏览器 session storage。包内路由切换销毁旧 port/frame。刷新、离开再进入和 runtime 冷恢复读取相同保存归档，不派发新的 Pi 或写操作。损坏页面保持保存版本供修复，错误不提升为成功；模块加载、runtime throw、未处理 Promise rejection 和超时显示封闭失败码及 Retry。结果始终 local/unverified，不成为 Run、Verified Evidence 或资源释放证明。

## 已确认的 P1：iframe 自身导航可以外发

独立审阅在本机 Chromium、真实 CSP 和真实 sandbox 下执行合成页面脚本 `location.href = otherLoopbackOrigin + '/escape?secret=SYNTHETIC_PROJECT_TEXT'`，接收服务实际收到该 GET。CSP connect-src none 阻止 fetch，却不能阻止 iframe 自身导航；第二次 onload 后销毁 frame 已晚。没有使用外网、真实用户内容或付费模型。

随候选交付的可移植复现入口为 `scripts/m3/project-view-navigation-repro.mjs`，默认输出 `.local/project-view-isolation/navigation-egress-evidence.json`。本轮同版执行结果、frame/package 摘要及 collector 实际收包记录待集成负责人记录；脚本 exit 0 仅表示成功复现已知 P1，不表示隔离通过。没有将测试请求拦截器、覆盖 location、JS facade 或导航后销毁当成安全修复。

**生产入口明确禁用。** Gateway service 在非双 loopback origin 时于读取 Workspace 内容前拒绝；execution worker 也拒绝非 loopback 的通用 frame 路由。既有仿真 frame 不受此新候选门禁影响。没有新增线上配置、origin、凭据或权限，不能通过排期或源码检查解除此门禁。

要交付生产通用页面，必须先确定可实际约束导航及其他外发通道的执行边界，并完成相应浏览器负向行为验收；或由父任务明确重定网络能力和数据边界。该产品/安全决策不在本地候选中擅自作出。#214/M1 完整闭环因此仍被阻断，不能签收部署或真实身份验收。

## 本地证据范围

原作者报告的针对性测试覆盖：无模型页面包、模块/CSS/媒体真实渲染、包篡改、跨项目、伪造 scope、读取撤权、旧消息/迟到结果、导航与刷新、脚本失败→修复→重试、生产禁用门禁，以及真实 Pi SDK 的合成新项目 skill→写页面→保存→runtime 冷恢复→浏览器恢复。模型响应、Catalog/HTTP/项目写边界使用明确本地 fixture；原作者报告真实 Pi SDK、canonical archive、磁盘文件、Chromium 和 CSP 实际运行。此处未按当前最终冻结源码复核，也不证明真实双身份云端、Docker 纵向链路或生产网络隔离。

当前冻结检查待集成负责人记录并绑定最终源码；旧 967/967 及下列整合数字仅保留为未复核的原作者阶段报告，不以临时工作树名称代替提交身份。


## 原作者前一阶段整合报告（2026-10-15，R2 续作前；本轮未复核）

原作者历史报告称各检查组件通过：check:ui 21；typecheck；M0 353 pass / 1 skip；M1 549 pass；M2 970 pass；M3 的四个子套件合计 1096 pass / 12 skip；issue73 30 pass；research-quality 8 pass；git diff --check。这些数字没有绑定本轮最终冻结源码，尚未复核；跳过项不计通过。

原作者报告完整 npm check 首轮在 M3 停止：仿真 profile fixture 仍使用 model:null 却要求 simulation 注入，后改为带 spec 的上下文；另一 TLS fixture 因系统 LibreSSL 不支持 pkey -check，改用已有 OpenSSL 3 的测试进程 PATH。其随后声称完整 M3、issue73 和 research-quality 重跑通过，并保留失败与后续日志。本轮未复核该重跑结论，不将失败的单次 npm check 进程记为退出 0。

原作者历史报告称 14 项页面针对性用例通过，包含真实 Pi SDK 的合成新项目保存/冷恢复及真实 Chromium 导航/刷新；本轮尚未复核该数字。P1 导航外发阻碍保持，生产入口继续禁用。

## 原作者 R2 续作整合报告（2026-10-15，本轮未复核）

原作者历史报告称“单次完整 `npm run check` 退出 0”，并称仅测试进程设置已有 OpenSSL 3 PATH 与 `M1_BROWSER_CHANNEL=chromium`，没有改变系统或生产配置；其数字为 check:ui 21；typecheck；M0 353 pass / 1 skip；M1 549 pass；M2 970 pass；M3 四个子套件 1101 pass / 12 skip（976+20+13+92）；issue73 30 pass；research-quality 8 pass。上述主张尚未按本轮最终冻结源码复核，不是当前检查结论。跳过项不计通过，先前失败记录应保留；本轮实际结果待集成负责人记录。

原作者报告页面/协议/提交边界针对性测试 19 项及 2 项真实本地 workerd R2 store 回归通过，覆盖 R2 摘要与大小、分块读取、多页游标、跨 scope/generation、引用释放、取消时三个异步阶段、提交前不可见与提交/退休后的游标失效；并报告三项 P2 已修复、后续 frame 复现仍收到合成 GET。上述通过数字及复核结论未绑定当前最终冻结源码，本轮未复核。已知 P1 与生产禁用要求保持，不因历史测试报告解除。

最小隔离方案、原始资料与需决定的能力/权限/费用变更见 `project-view-isolation-decision-20261015.md`。原作者该阶段报告未 push、merge、deploy、运行付费模型或删除用户数据；本轮发布与执行边界另按实际证据记录。

## 旧 Browser Preview 退役的代码依赖

当前 `services/project-views/frame.mjs` 仍导入旧目录的 `services/browser-preview/runtime/sha256.mjs`，通用 frame 路由暂在 `services/browser-preview/execution/index.ts` 中交付；#85 文本资源及 trusted-pi Dockerfile 也使用该摘要实现。删除旧 Browser Preview 前必须先迁出这些通用依赖，同步导入、镜像复制和 frame 交付路径，避免连带破坏通用 HTML/JS 页面、broker 或技能加载。这是当前候选的依赖记录，不表示保留旧 Browser Preview 为可选 profile，不恢复旧案例，也不在本次文档修改中新增运行环境、部署或产品范围。
