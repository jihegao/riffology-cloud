# #214 导航外发 P1：最小决策与边界

本地候选持续禁用生产交付。本记录不改变安全标准、配置或产品能力；没有部署新服务、创建浏览器资源、扩大网络权限、收费运行或删除数据。

## 结论与可重复证据

任意 DOM JavaScript 已取得项目数据后，标准 iframe 无法同时保证禁止向任意目的地外发。保留 opaque origin、sandbox 和 CSP 能隔离主站 DOM/凭据、阻止 fetch 等通道，但自身导航可将数据置于 URL 中发送。

合成复现：`navigation-egress-repro.mjs` 在真实 Chromium 中安装现有 frame/CSP，使页面执行携带 `SYNTHETIC_PROJECT_TEXT` 的自身导航；另一个 loopback HTTP 服务实际收到请求。`navigation-egress-evidence.json` 保存实际到达证据。第二次 onload 后销毁已晚；未将 CSP、覆盖 location、Navigation API 或 Playwright route 拦截当作修复。

## 已比较的边界

- HTML 标准 sandbox 导航限制排除自身及后代 context，因此 iframe 自身导航仍可发送请求：[WHATWG HTML](https://html.spec.whatwg.org/multipage/browsers.html#sandboxed-navigation-browsing-context-flag)。
- CSP3 当前导航指令是 form-action 与 frame-ancestors，没有通用自身导航阻止指令：[W3C CSP3](https://www.w3.org/TR/CSP3/#directives-navigation)。
- Navigation API 在 opaque origin 下禁用 entries/events，不能补齐当前边界：[WHATWG Navigation API](https://html.spec.whatwg.org/multipage/nav-history-apis.html#navigation-has-entries-and-events-disabled)。
- Fenced frames 无法直接承载现有父子 postMessage broker；Chrome 官方页面现标记逐步移除，不采用为新生产依赖：[Chrome 官方状态](https://privacysandbox.google.com/private-advertising/fenced-frame)。
- 可用方向是独立于可信 Pi 的 Chromium 进程运行域，由 OS/container/VM 的真实网络边界断网；输入冻结包和有界只读 IPC，输出像素/有界消息，宿主用户浏览器不运行项目脚本。Docker network none 只提供 loopback：[Docker](https://docs.docker.com/engine/network/drivers/none/)。浏览器自身 sandbox/non-root 要求仍保留：[Playwright](https://playwright.dev/docs/docker)。网络请求拦截只能作为附加防护。

## 最小推荐方案与需决定事项

若保留任意 DOM JS 与私有项目数据，新增专用 BrowserView runtime：可信 supervisor 分配专属、无外部 NIC 的浏览器容器/VM，只装冻结包、浏览器、临时目录；不提供用户 profile、云令牌、宿主目录或 Docker socket。通过受控 pipe/IPC 输入当前 scope 数据及鼠标键盘事件，输出有界画面和封闭消息。所有读取/续租重新授权，关闭时持久 fence 并确认子进程退出。Observer 的摘要、取消与停止栅栏思路可复用，但现有 adapter 本身要求外部已验证网络栅栏，仓库没有现成可启动的 OS fence/launcher，短时 Observer 也不是持续交互 viewer。

该方案需要明确批准以下具体变化后再实现其依赖：

1. 页面由用户浏览器 DOM 改为隔离浏览器画面，含输入转发/可访问性、复制与下载行为的产品选择。
2. 新增浏览器镜像/进程运行权限及 OS 网络 namespace/VM 隔离部署配置。
3. 浏览器算力、并发/会话时限和相应费用预算。

若不批准该运行环境，替代方案是可信声明式渲染器（取消任意 DOM JS）或只允许公开/合成数据；这些也改变已批准能力，不能由本地实现自行选择。当前仅研究并冻结以上方案，没有启动或配置新运行环境。此依赖等待决定；#85 与本地只读订阅继续独立验证。
