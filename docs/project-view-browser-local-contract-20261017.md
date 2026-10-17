# 通用页面的浏览器本地原生 DOM 合同 — 2026-10-17

**Selection: native DOM（用户已选定）。** 本文记录已选产品与安全合同，不是生产实现、发布配置、线上验收通过或新增路线图。负责人：@jihegao；范围与阶段以 [#214](https://github.com/jihegao/riffology-cloud/issues/214) 和 [Delivery Project](https://github.com/users/jihegao/projects/1) 为准。

用户本人原话：

> 原生 DOM 页面：优先兼容现有 DOM JavaScript，明确接受页面可外发已获授权的项目数据。

记录时间：**2026-10-17 09:19:47 UTC**（17:19:47 Asia/Shanghai，工具读取的记录时间，不冒充该消息的精确发送时间）。该选择明确接受下文的数据外发差异；不会授予页面跨项目、凭据读取或 canonical 保存权限。

#214 最新范围及用户 2026-10-17 16:50 的方向确认要求当前页面在用户浏览器执行、计算和渲染。远程 Chromium/PNG 不再是当前目标，也不作为未来方向；未来云端 Rust 执行另需计费方案。已经完成的 canonical pages 保存、恢复、包校验及只读 broker 可以复用；不能把旧远程 basic 启动或 Cloudflare release ACK 验收重新列为本地页面交付前置。#218 和完整 JHG-56 验收继续后置。

## 已有证据与它能回答的问题

本次 [浏览器可行性证据](../evidence/releases/project-view-browser-local-feasibility-20261017.json) 记录 2026-10-17 的一次本机 Chromium 153.0.8010.12 合成实验。[可复查脚本](../scripts/m3/project-view-browser-local-feasibility.mjs) 与该证据一起集成，证据区分实际执行脚本与便携入口的摘要；便携入口的路径/输出参数整理不表示重跑。它没有登录真实账号、调用模型、访问生产项目或启动云端容器。

- 将实验所用 main `1585280` 的 `project-views/frame.mjs` 真实 HTML/CSP 与现有包校验、只读 broker 接合后，页面读到了合成 canary，并通过 `location.href` 自身导航使 loopback collector 实际收到该字节。原 CSP 的 `connect-src 'none'` 没有阻止该导航。这是该基线 frame 的缺口复现，不能记为隔离通过。
- 另一个固定可信 opaque bootstrap 创建了 classic Blob Worker。该 Worker 实际使用本次自定义合成 MessagePort responder 提供的 `series.json` 数据 `[2,3,5]` 做计算，尚未贯通产品 `createProjectViewBroker` 协议桥接；真实 `verifyProjectViewPackage` / `createProjectViewBroker` 仅在上述 DOM baseline 中贯通。参数从 2 改为 5 后结果从 20 变为 50；OffscreenCanvas 生成了不同 ImageBitmap，本机浏览器完成显示。它证明这条路径能够执行本地计算和交互输出，未依赖 ModelSpec 或 trace；**它没有实现通用 HTML/CSS 渲染器，也没有证明任意 DOM JS 兼容**。
- 该 Worker 对 app API 与 collector 的带凭据 fetch、WebSocket、远程 importScripts、远程 Worker 尝试均失败，collector 未收到这些目标请求；Worker 无 `window`/`document`，location 赋值或导航方法也失败。collector 和带合成 Cookie 的 app API 在前后正对照中均可用。测试额外阻断非 loopback 的 harness 防护没有触发，所测目标为直接放行的 loopback。
- Worker terminate、Blob URL revoke、port/frame/listener 移除，以及 Worker target 归零、浏览器 context/browser 与本地服务器关闭均有记录。它们只是本次本地生命周期观察，不是浏览器硬资源配额证明。

公开标准与结果一致：HTML sandbox 的导航限制允许 context 自身导航；CSP3 的导航指令是 `form-action` 和 `frame-ancestors`，没有可直接封闭任意自身导航的通用指令。[HTML sandbox](https://html.spec.whatwg.org/multipage/browsers.html#sandboxed-navigation-browsing-context-flag)、[CSP3 navigation directives](https://www.w3.org/TR/CSP3/#directives-navigation)。Worker 没有 DOM，WorkerLocation 属性只读；Blob Worker 继承创建者的 CSP，而普通 URL Worker 的执行策略不能仅从创建页面推断。[Worker 使用与 CSP 继承](https://developer.mozilla.org/en-US/docs/Web/API/Web_Workers_API/Using_web_workers#content_security_policy)、[HTML WorkerLocation](https://html.spec.whatwg.org/multipage/workers.html#worker-locations)。`connect-src` 约束 fetch、XHR、WebSocket、EventSource 等脚本网络接口。[connect-src](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Content-Security-Policy/connect-src)。

## 选择记录与两项合同的差异

| 选择 | 原生 DOM 页面（本次选定） | Worker 计算与可信通用渲染器（未选） |
| --- | --- | --- |
| 页面代码在哪里运行 | 固定 frame 可从主站同源交付，但运行时由 sandbox 置于 opaque origin；项目 HTML/JS 在该 frame 中运行，可直接使用其 DOM；既有 sandbox/CSP 限制仍适用，不承诺全部浏览器 API 或第三方库兼容。 | 项目计算 JS 只在 Worker 中运行；可信 frame 渲染通用 HTML/CSS 或经校验的 DOM 树/patch，输入事件经有界协议传回 Worker。 |
| 项目数据与网络合同 | 已经授权交付给页面的项目字节可能由该页面外发，自身导航已实际复现。用户已明确接受这一点；不把它改写为无外发保证。 | 保留禁止项目代码外发的目标，以 Worker CSP 和可信渲染器共同约束出口；必须实现并验证，不能由本次 spike 直接签收完整隔离。 |
| 页面兼容性 | 更接近现有任意 DOM JS 页面；不能声称完全兼容或无外发。 | 原 DOM JS、依赖 DOM 的库和模块入口必须适配 Worker API、可信渲染协议及闭包内依赖 bundle；不是原页面的透明替换。 |
| 对 JHG-46 完成范围的影响 | 将保存、恢复、两页 DOM 展示和交互作为本地流程；把数据外发风险作为明确接受的产品合同。 | 在相同 canonical 保存/恢复上补 Worker 加载、通用可信渲染、事件与 broker 桥接，再验两页本地交互。计算逻辑可由项目自由编写，不改回固定 ModelSpec/trace。 |

**本次按原生 DOM 合同推进。** 不实现 Worker 通用渲染器，不把旧页面改写为固定 ModelSpec/trace 或远程 PNG；Worker 比较和 spike 保留为选择依据。若未来重新要求禁止页面外发，必须重新评估合同，不能声称原生 DOM 已满足这一要求。

两项选择都保留主站安全边界：opaque frame 不获得主站 DOM、Cookie、Authorization 或认证存储的脚本读取能力；只读 broker 继续绑定真实 owner/authVersion、tenant/project/workspace/generation 和当前 package identity，拒绝跨项目、写操作、自报 scope 及迟到结果。它不成为任意 app API、云资源或全桶读取代理。

原生 DOM 合同尤其不能承诺“页面发出的请求一律不带既有站点 Cookie”。脚本不可读主站 Cookie，与浏览器在导航等请求中按目标站点、Cookie 属性和浏览器策略附带凭据，是不同边界。本次 collector 未收到合成 Cookie，只能描述该次观察；不能外推为所有目标与所有请求无凭据。主站鉴权、Origin 检查和跨项目拒绝均不得放宽。

## 本次原生 DOM 的 authoring 合同

通用页面继续使用 `project.views/v1` 与 Managed v3 `operation:"pages"`：`app/views.json` 声明完整本地 HTML/modules/CSS/媒体闭包，`files` 仅提交已声明的 UTF-8 文本补丁；页面可执行自己的 DOM JavaScript、本地计算和交互。平台沿已有 canonical Revision 保存并恢复原始文本、包身份和摘要；不要求 ModelSpec、`model/results.json` 或 `preview.trace`，不进入旧固定场景协议。页面经共享只读 `riffoid` API 读取被授权的文件/Artifact及包内导航；页面 DOM 更新不等于项目保存，broker 不开放 canonical 写操作。

现有声明闭包、模块导入、路径和体积限制保留；接受数据可能外发，不等于新增 CDN、隐式安装或 Agent 网络权限。新项目先通过正常作者流程保存 `.pi/skills/<slug>/SKILL.md`，下一 Turn 显式 `/skill:name` 加载后生成双页。已有用户 skills、模型/设计文件和历史 Revision 保留，不由平台静默重写。

源码入口是 [Managed authoring 指令](../services/turn-runtime/managed-testing-instructions.ts) 的 `pages` 段；该段说明用户浏览器原生 opaque DOM、本地计算及只读边界，并保留不需要 Spec/trace 的操作语义。指令开头的 Agent Network/credentials/subagents unavailable 继续限制 Agent 运行权限，不解释为任意页面没有外发能力。仓库没有生产内置的通用 pages `SKILL.md`；[项目资源解析](../services/project-resources/text.mjs) 和 [Managed 显式选择](../services/turn-runtime/managed-resources.ts) 从当前保存归档加载用户资源。Trusted Pi 的 [旧仿真技能分流](../services/trusted-pi/release-candidate.mjs) 仅在已有 `model.spec` 时注入，不把其五文件/固定 trace 合同扩成通用页面前置。

## 当前候选接线

[本地适配器](../services/web/project-view-local.js) 只接收 `execution:"browser-local"`、`transport:"native-dom/v1"` 的精确 delivery，固定同源摘要地址交付 bootstrap，再以 `sandbox="allow-scripts"` 置于 opaque origin。随机 nonce、原 frame source、`origin:"null"` 和单次 MessagePort 转移绑定本次安装；不回退远程执行。项目 DOM/JS 由该 frame 自行计算和渲染，包校验与只读 broker 沿用既有权威，不增加云端会话或容器租约。

源码新增独立、默认关闭的 `PROJECT_VIEW_BROWSER_POLICY_JSON`：完整启用合同为 `schema:"project-view-browser-policy/v1"`、`enabled`、`startsAt`、`endsAt`、`dataEgress:"accepted"` 和精确 `scope`/`actor` grants。初次受控验收窗口最多 24 小时，最多 16 个 grants；缺少、失效或字段不完整即关闭。它不依赖镜像/远程容量，也不会开启原 `PROJECT_VIEW_POLICY_JSON`。这只是可部署候选能力，本文没有设置任何线上 grant。

本地包、当前身份和 Artifact GET 继续复核普通 accepted invitation、personal owner、authVersion、当前 scope/generation 及未归档状态，并在异步读取后再次检查；initial operator 身份不能代替普通邀请。刷新、切页、离开、撤权和包更新销毁旧 frame/broker，并丢弃迟到结果。导航、脚本错误、加载超时或读取失败后锁定原包；只读轮询即使恢复同一包也不重执行，用户显式重试才解除该锁。刷新或重新打开能重新加载保存的内容，不恢复已销毁的 JS 内存或把本地结果记成服务端 Run。

固定 frame 使用签入的 [生成字节](../services/project-views/frame-html.mjs)，由 [可读 bootstrap](../services/project-views/frame-source.mjs) 离线生成，避免构建器重排 `Function.toString()` 改变摘要地址。修改源后运行 `node scripts/m3/build-project-view-frame.mjs --write`；`--check` 和实际 Entry/Gateway 测试核对生成同步、Node 与 Workerd 的 HTML/摘要一致。

## 未选 Worker 合同的比较边界

以下仅保留未选方案的设计分析，不是当前实现任务或当前完成条件。

1. 可信 bootstrap 由固定代码交付，iframe 保持 `allow-scripts` 且不含 `allow-same-origin`；只有经过包校验的项目 JS 进入 Worker。固定 bootstrap 外，不把项目脚本、事件属性或任意 worker 输出放进 frame 执行；Worker 失败也不得回退到原生 DOM JS。
2. Worker CSP 保持 `connect-src 'none'`、拒绝外部脚本来源和不必要的 eval。classic Blob Worker 已有本次可行性证据；模块图加载、循环依赖及依赖 bundle 尚需实现与实测，不能假定 opaque module Worker 或现有 import map 原样适用。依赖必须来自声明且摘要验证的包闭包，不隐式访问 CDN、安装包或开放网络 fetch 代理。
3. 通用渲染器支持的标签、属性、CSS、媒体与事件写成明确合同；不限制计算为某个 ModelSpec，也不把任意 HTML/JS 全兼容写成承诺。渲染输出及后续 patch 均验证：导航只接受包内 view 标识；拒绝 script、事件处理器、meta refresh、form action、frame/object、外部 URL、预连接和可执行 SVG 等载荷；不能仅靠 click 拦截或事后 onload 销毁补救。
4. 当前 canonical 包/Revision、文件摘要、作用域和只读 broker 复核保留；消息、节点数/深度、文本、事件频率、在途读取和渲染结果均有界。子 Worker、持久存储与通信入口的加固不能替代 CSP；项目代码也不能选择任意 host API 或伪造成功/证据消息。
5. 切页、刷新、离开、包更新及授权失效时停止原 Worker、撤销 Blob URL、关闭 port，并以 generation 丢弃迟到输出。本地结果始终 local/unverified，不成为 Run 或 Verified Evidence。

## 未证明事项与风险匹配验证

本次 spike 只证明特定 Chromium 的选定行为：原生 DOM 的已授权数据自身导航外发，以及 Worker 的简单计算/绘图和选定接口阻断。Safari/WebKit、Firefox、真实认证用户、跨项目与撤权、完整双页保存恢复、通用 DOM/CSS 渲染器、实际依赖 bundle 和第三方库兼容均未验。OffscreenCanvas 的两幅不同图像不能替代 HTML 页面、表单、可访问性、文本选择或复制行为验收。

浏览器本地执行没有应用可依赖的硬 CPU/RAM 配额；原生 DOM 无限循环可能阻塞 frame/renderer，不能把 Worker terminate 当作原生 DOM 的终止保证。标准 Worker 提供终止能力，也不提供硬配额；无限循环、内存分配、DOM/CSS 复杂度或消息洪泛仍可能使用户浏览器迟缓或崩溃。需要超时/取消、消息与渲染预算、错误隔离及离开后清理验证，不能承诺 OS 级资源隔离。单次 collector 零命中也不能证明所有浏览器、所有未来 API 或所有外发通道安全。

按已选原生 DOM 合同，针对实际实现验证：无 ModelSpec 的 canonical 双页包、本地计算和输入、模块/CSS/媒体及普通用户保存/刷新/离开恢复；真实 CSP/sandbox 的实际限制及已接受的自身导航外发，导航/HTML/SVG/CSS 载荷不应越过主站或跨项目权限；broker 伪造、跨 scope/package、撤权及迟到输出；超限/无限循环取消和下一次正常页面恢复。报告具体浏览器版本、实际行为和未覆盖项；不把 fixture 升格为真实用户验收，也不把完整 #218/JHG-56 矩阵重新设为本批开发前置。

本次记录合同选择并最小更新 Managed pages 的 authoring 说明，不修改生产 gate，不部署或发起付费调用。本地 spike 不是这次原生 DOM 产品接线或线上验收通过。已经发布的云端资源保持页面 policy closed、max1 及最近一次空实例清单的独立记录；本地合同不启用它们。其盘点、停用或退役另按具体范围处理，不自动删除资源、namespace 或历史。
