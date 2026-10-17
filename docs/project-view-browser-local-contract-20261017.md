# 通用页面的浏览器本地执行合同选择 — 2026-10-17

**Selection: pending。** 本文是待选择的产品与安全合同，不是生产实现、发布配置或新增路线图。负责人：@jihegao；范围与阶段以 [#214](https://github.com/jihegao/riffology-cloud/issues/214) 和 Delivery Project 为准。

#214 最新范围及用户 2026-10-17 16:50 的方向确认要求当前页面在用户浏览器执行、计算和渲染。远程 Chromium/PNG 不再是当前目标，也不作为未来方向；未来云端 Rust 执行另需计费方案。已经完成的 canonical pages 保存、恢复、包校验及只读 broker 可以复用；不能把旧远程 basic 启动或 Cloudflare release ACK 验收重新列为本地页面交付前置。#218 和完整 JHG-56 验收继续后置。

## 已有证据与它能回答的问题

本次 [浏览器可行性证据](../evidence/releases/project-view-browser-local-feasibility-20261017.json) 记录 2026-10-17 的一次本机 Chromium 153.0.8010.12 合成实验。[可复查脚本](../scripts/m3/project-view-browser-local-feasibility.mjs) 与该证据一起集成，证据区分实际执行脚本与便携入口的摘要；便携入口的路径/输出参数整理不表示重跑。它没有登录真实账号、调用模型、访问生产项目或启动云端容器。

- 将当前 `project-views/frame.mjs` 的真实 HTML/CSP 与现有包校验、只读 broker 接合后，页面读到了合成 canary，并通过 `location.href` 自身导航使 loopback collector 实际收到该字节。原 CSP 的 `connect-src 'none'` 没有阻止该导航。这是当前 frame 的缺口复现，不能记为隔离通过。
- 另一个固定可信 opaque bootstrap 创建了 classic Blob Worker。该 Worker 实际使用本次自定义合成 MessagePort responder 提供的 `series.json` 数据 `[2,3,5]` 做计算，尚未贯通产品 `createProjectViewBroker` 协议桥接；真实 `verifyProjectViewPackage` / `createProjectViewBroker` 仅在上述 DOM baseline 中贯通。参数从 2 改为 5 后结果从 20 变为 50；OffscreenCanvas 生成了不同 ImageBitmap，本机浏览器完成显示。它证明这条路径能够执行本地计算和交互输出，未依赖 ModelSpec 或 trace；**它没有实现通用 HTML/CSS 渲染器，也没有证明任意 DOM JS 兼容**。
- 该 Worker 对 app API 与 collector 的带凭据 fetch、WebSocket、远程 importScripts、远程 Worker 尝试均失败，collector 未收到这些目标请求；Worker 无 `window`/`document`，location 赋值或导航方法也失败。collector 和带合成 Cookie 的 app API 在前后正对照中均可用。测试额外阻断非 loopback 的 harness 防护没有触发，所测目标为直接放行的 loopback。
- Worker terminate、Blob URL revoke、port/frame/listener 移除，以及 Worker target 归零、浏览器 context/browser 与本地服务器关闭均有记录。它们只是本次本地生命周期观察，不是浏览器硬资源配额证明。

公开标准与结果一致：HTML sandbox 的导航限制允许 context 自身导航；CSP3 的导航指令是 `form-action` 和 `frame-ancestors`，没有可直接封闭任意自身导航的通用指令。[HTML sandbox](https://html.spec.whatwg.org/multipage/browsers.html#sandboxed-navigation-browsing-context-flag)、[CSP3 navigation directives](https://www.w3.org/TR/CSP3/#directives-navigation)。Worker 没有 DOM，WorkerLocation 属性只读；Blob Worker 继承创建者的 CSP，而普通 URL Worker 的执行策略不能仅从创建页面推断。[Worker 使用与 CSP 继承](https://developer.mozilla.org/en-US/docs/Web/API/Web_Workers_API/Using_web_workers#content_security_policy)、[HTML WorkerLocation](https://html.spec.whatwg.org/multipage/workers.html#worker-locations)。`connect-src` 约束 fetch、XHR、WebSocket、EventSource 等脚本网络接口。[connect-src](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Content-Security-Policy/connect-src)。

## 两项可选择的合同

| 选择 | 原生 DOM 页面 | Worker 计算与可信通用渲染器 |
| --- | --- | --- |
| 页面代码在哪里运行 | 固定 frame 可从主站同源交付，但运行时由 sandbox 置于 opaque origin；项目 HTML/JS 在该 frame 中运行，可直接使用其 DOM；既有 sandbox/CSP 限制仍适用，不承诺全部浏览器 API 或第三方库兼容。 | 项目计算 JS 只在 Worker 中运行；可信 frame 渲染通用 HTML/CSS 或经校验的 DOM 树/patch，输入事件经有界协议传回 Worker。 |
| 项目数据与网络合同 | 已经授权交付给页面的项目字节可能由该页面外发，自身导航已实际复现。选择此项须明确接受这一点。 | 保留禁止项目代码外发的目标，以 Worker CSP 和可信渲染器共同约束出口；必须实现并验证，不能由本次 spike 直接签收完整隔离。 |
| 页面兼容性 | 更接近现有任意 DOM JS 页面；不能声称完全兼容或无外发。 | 原 DOM JS、依赖 DOM 的库和模块入口必须适配 Worker API、可信渲染协议及闭包内依赖 bundle；不是原页面的透明替换。 |
| 对 JHG-46 完成范围的影响 | 将保存、恢复、两页 DOM 展示和交互作为本地流程；把数据外发风险作为明确接受的产品合同。 | 在相同 canonical 保存/恢复上补 Worker 加载、通用可信渲染、事件与 broker 桥接，再验两页本地交互。计算逻辑可由项目自由编写，不改回固定 ModelSpec/trace。 |

**若禁止已授权项目数据外发仍是硬要求，建议选择 Worker 合同。** 若选择原生 DOM，必须由用户明确接受上述数据外发差异；不能把浏览器本地执行的方向确认自动视作接受外发。

两项选择都保留主站安全边界：opaque frame 不获得主站 DOM、Cookie、Authorization 或认证存储的脚本读取能力；只读 broker 继续绑定真实 owner/authVersion、tenant/project/workspace/generation 和当前 package identity，拒绝跨项目、写操作、自报 scope 及迟到结果。它不成为任意 app API、云资源或全桶读取代理。

原生 DOM 合同尤其不能承诺“页面发出的请求一律不带既有站点 Cookie”。脚本不可读主站 Cookie，与浏览器在导航等请求中按目标站点、Cookie 属性和浏览器策略附带凭据，是不同边界。本次 collector 未收到合成 Cookie，只能描述该次观察；不能外推为所有目标与所有请求无凭据。主站鉴权、Origin 检查和跨项目拒绝均不得放宽。

## Worker 合同需落实的最小边界

这部分说明选择该项后需要实现和验收什么，不表示已经选定或已经具备。

1. 可信 bootstrap 由固定代码交付，iframe 保持 `allow-scripts` 且不含 `allow-same-origin`；只有经过包校验的项目 JS 进入 Worker。固定 bootstrap 外，不把项目脚本、事件属性或任意 worker 输出放进 frame 执行；Worker 失败也不得回退到原生 DOM JS。
2. Worker CSP 保持 `connect-src 'none'`、拒绝外部脚本来源和不必要的 eval。classic Blob Worker 已有本次可行性证据；模块图加载、循环依赖及依赖 bundle 尚需实现与实测，不能假定 opaque module Worker 或现有 import map 原样适用。依赖必须来自声明且摘要验证的包闭包，不隐式访问 CDN、安装包或开放网络 fetch 代理。
3. 通用渲染器支持的标签、属性、CSS、媒体与事件写成明确合同；不限制计算为某个 ModelSpec，也不把任意 HTML/JS 全兼容写成承诺。渲染输出及后续 patch 均验证：导航只接受包内 view 标识；拒绝 script、事件处理器、meta refresh、form action、frame/object、外部 URL、预连接和可执行 SVG 等载荷；不能仅靠 click 拦截或事后 onload 销毁补救。
4. 当前 canonical 包/Revision、文件摘要、作用域和只读 broker 复核保留；消息、节点数/深度、文本、事件频率、在途读取和渲染结果均有界。子 Worker、持久存储与通信入口的加固不能替代 CSP；项目代码也不能选择任意 host API 或伪造成功/证据消息。
5. 切页、刷新、离开、包更新及授权失效时停止原 Worker、撤销 Blob URL、关闭 port，并以 generation 丢弃迟到输出。本地结果始终 local/unverified，不成为 Run 或 Verified Evidence。

## 未证明事项与风险匹配验证

本次 spike 只证明特定 Chromium、选定网络接口和简单计算/绘图的可行性。Safari/WebKit、Firefox、真实认证用户、跨项目与撤权、完整双页保存恢复、通用 DOM/CSS 渲染器、实际依赖 bundle 和第三方库兼容均未验。OffscreenCanvas 的两幅不同图像不能替代 HTML 页面、表单、可访问性、文本选择或复制行为验收。

标准 Worker 提供终止能力，不提供应用可依赖的硬 CPU/RAM 配额；无限循环、内存分配、DOM/CSS 复杂度或消息洪泛仍可能使用户浏览器迟缓或崩溃。需要超时/取消、消息与渲染预算、错误隔离及离开后清理验证，不能承诺 OS 级资源隔离。单次 collector 零命中也不能证明所有浏览器、所有未来 API 或所有外发通道安全。

选择合同后，针对实际实现验证：无 ModelSpec 的 canonical 双页包、本地计算和输入、模块/CSS/媒体及普通用户保存/刷新/离开恢复；真实 CSP 下的正对照与所选网络负例；导航/HTML/SVG/CSS 载荷；broker 伪造、跨 scope/package、撤权及迟到输出；超限/无限循环取消和下一次正常页面恢复。报告具体浏览器版本、实际行为和未覆盖项；不把 fixture 升格为真实用户验收，也不把完整 #218/JHG-56 矩阵重新设为本批开发前置。

本次只新增决策合同与本地证据入口，不修改生产 source 或任何 gate，不发起付费调用。已经发布的云端资源保持页面 policy closed、max1 及最近一次空实例清单的独立记录；本地合同不启用它们。其盘点、停用或退役另按具体范围处理，不自动删除资源、namespace 或历史。
