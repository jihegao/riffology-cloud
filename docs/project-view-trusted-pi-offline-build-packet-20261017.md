# #214 TrustedPi 项目资源镜像：下一批离线构建输入包 — 2026-10-17

负责人：@jihegao；范围以 [#214](https://github.com/jihegao/riffology-cloud/issues/214) 和 [#85](https://github.com/jihegao/riffology-cloud/issues/85) 为准。本页与 [safe JSON](../evidence/releases/project-view-trusted-pi-offline-build-20261017/review.json) 是独立可审 packet，不授予执行权限，不修改当前 Gateway/assets 的默认关闭发布、readiness、冻结 sender/metadata 或历史操作件。当前只完成本地准备和独立只读审阅。

## 具体问题与已有实现

普通受邀用户默认产品 UI 走 Pi，#214 不要求 Managed/Hosted。当前 canonical 保存、只读页面 broker 与浏览器原生 DOM 合同继续复用；用户已接受页面可能外发已经获授权的项目字节。此包只解决正常 Pi 作者所需的镜像载体差异，不引入 ModelSpec/trace 门槛，也不把完整 JHG56 或第二身份矩阵提升为前置。

2026-10-17 10:35:29.064–29.705 UTC 的 Personal connector 只读 app→全部 versions→同 app 三 GET 均200，确认既有 TrustedPi 仍 v11/100% 指向 `9b76ab9e…`，仅另有 v10/0%，完整 app/versions hash 与前一基线相同。它是元数据观察，不是新容器 inspect 或启动。该旧镜像的历史源码 `481306e` 没有新项目文本 loader，且无条件注入旧 simulation profile。真实路径只写 control/Session 数据并启动 baked host，再 import baked controlled-pi/release；不会每请求注入当前源码。

新 loader、条件 simulation prompt 以及全部运行输入已经在 main `1585280c76e55cae61f3969db5545f76edce678c` 与实现 `bc4c0377dd4a59c6ddf6b9de71e3f0fcbe028999` 逐字节相同。两份完整 Dockerfile 已有 sha256/text COPY，无需为这两行再开发修复。此兼容包不依赖 PR235 的 Gateway 代码；后续只更新既有镜像，不新增 app/namespace/运行架构。

## 精确输入及公开副本

待批准的小包文件名为 `jhg46-pi-resource-compat-v1-20261017.tar.gz`，**30,515 B**，SHA256 **`c92e672ca39d10d61467801f457147e3ee9cf2cfbbbe8b96d00a618a6a208bae`**。tar 不入库。USTAR 普通成员按名排序，uid/gid0、空 owner 名、mtime0，文件0444/探针0555；gzip9 的 mtime0/filename空。两次本地打包字节完全一致。解压后 tar102,400 B、SHA `1bc5305af54b7fad81cc1ce95f545513c82a02565ca96381fede6fb3856fd52b`，恰9成员、正文90,549 B，无链接、绝对/父路径。

固定 FROM：

```text
registry.cloudflare.com/8b0d70250211aa10d89e20605a1c7e5e/riffology-issue165-trusted-pi@sha256:9b76ab9ee7a4f31d250957fbbeefc62d71056e6bd1eb24686ebbeaff3d65873c
```

overlay 为5份源、6个目标，包括 active `trusted-pi-release.mjs` alias；保留依赖锁、host/supervisor、uid10002、固定 provider/model/工具权限、原 app/namespace/default/max1 和其它资源。没有 npm install、基础镜像替换或新依赖。下面九份公开源码副本与小包内容逐字节一致，不含 tar、凭据、私有 actor、Worker 原配置或历史请求。

| 公开源码副本 | 字节 | SHA256 |
| --- | ---: | --- |
| [payload/EXECUTION-CONTRACT.md](../evidence/releases/project-view-trusted-pi-offline-build-20261017/payload/EXECUTION-CONTRACT.md) | 9,645 | `d77631c31751cdbbc72ead2ce9f866db5650d64fd77109d5f994f40494afc90f` |
| [payload/context/Dockerfile](../evidence/releases/project-view-trusted-pi-offline-build-20261017/payload/context/Dockerfile) | 1,245 | `bcdec6d274816323daa1c11b9245082efcf8132cc0d2901dab3cb13b2c9110b2` |
| [payload/context/services/browser-preview/runtime/sha256.mjs](../evidence/releases/project-view-trusted-pi-offline-build-20261017/payload/context/services/browser-preview/runtime/sha256.mjs) | 2,241 | `85da435e9edaf4dca3411cf5f86fa45a95fe15c78060849d11f7eb0344b5bd24` |
| [payload/context/services/project-resources/text.mjs](../evidence/releases/project-view-trusted-pi-offline-build-20261017/payload/context/services/project-resources/text.mjs) | 6,700 | `9f7f3266549f04a0a8214e6e725ea9d85030532364f136487833e9cc45af303e` |
| [payload/context/services/runtime/controlled-pi.mjs](../evidence/releases/project-view-trusted-pi-offline-build-20261017/payload/context/services/runtime/controlled-pi.mjs) | 23,072 | `cf4143bff6cf049d2ab8247ef86ceb5f5391da67a86acb56ea901a119b2d6871` |
| [payload/context/services/trusted-pi/release-candidate.mjs](../evidence/releases/project-view-trusted-pi-offline-build-20261017/payload/context/services/trusted-pi/release-candidate.mjs) | 27,185 | `034cdc9df6c09e9cd7a32320e6bbfc2f9bbf5761151fe1d585d7fd64cdcd8d07` |
| [payload/context/services/trusted-pi/research-context.mjs](../evidence/releases/project-view-trusted-pi-offline-build-20261017/payload/context/services/trusted-pi/research-context.mjs) | 1,557 | `938e89155a5d5e0c405f51db5d973a4db264e63d96e308aff8da93caaaa05076` |
| [payload/input-manifest.json](../evidence/releases/project-view-trusted-pi-offline-build-20261017/payload/input-manifest.json) | 6,884 | `f27b35dcbe84b58e3442018332374dbf20fa0d315528a322e56ea2a2bcfea5d4` |
| [payload/probe/compatibility-probe.mjs](../evidence/releases/project-view-trusted-pi-offline-build-20261017/payload/probe/compatibility-probe.mjs) | 12,020 | `bded581766c4656b05b72c6fce39fcb43461a44cbe407c0d1e9ab4a23edf2097` |

manifest SHA：`f27b35dcbe84b58e3442018332374dbf20fa0d315528a322e56ea2a2bcfea5d4`；probe SHA：`bded581766c4656b05b72c6fce39fcb43461a44cbe407c0d1e9ab4a23edf2097`。完整逐文件清单、双提交绑定和安全审阅范围见 safe JSON。

## 已做验证与限制

实际只运行本机 `source-equivalence`，Node26.10.0、fake model3/research1/project-tool0/ambient-fetch0。真实 Controlled Pi 和 product release 验证12个目标摘要、显式 skill Revision/path/SHA、未选正文不注入、同来源 cold provenance、来源变化后不继承加载标记、冷恢复不重放、无 ModelSpec 固定仿真指令、503不重试、取消后 settled/可快照，以及 dispose/临时目录清理。没有真实 token/provider 请求。

source 模式明确 `activeAliasActuallyInspected:false`，不冒充镜像内实读。首次本机检查因 macOS 自动加入 `__CF_USER_TEXT_ENCODING` 在 import 前失败，原失败已保留；只有 Darwin source 模式处理此字段，未来 Linux image 模式仍要求 only PATH、uid/gid10002、root-owned 不可写文件和真实 alias。独立 source_audit 只读复核包、9成员、11份 Git 输入、probe 和清理合同无 must-fix，没有重复执行测试或 API。

在上述原准备快照时，尚未 Docker/SSH/pull/build/传输/Registry 写/CF app update；随后仅进行下节单列的只读能力核对。SDK cancel 不等于 native fence、容器销毁或 capacity release；本机 mock 不替代镜像运行、普通身份、新项目初始化、canonical 用户保存或付费验收。新 derived image identity 仍未知；不把本地 image Id、buildx iid/config、registry manifest 混为一物，不声称 OCI 签名/attestation 或费用为0。

## 后续只读能力核对 — 2026-10-17

在原准备快照之后，root 对既有 AMD128 执行了一次 SSH 只读能力核对。[安全回执](../evidence/releases/project-view-trusted-pi-offline-build-20261017/capability-readonly.json)记录于 **2026-10-17 11:15:13.568 UTC**；这是工具成功返回后的记录时间，没有分别捕获命令起止时刻。回执 SHA256 为 `aab3686fc0d918bcfd9fd62c89c3d4a801646b33a8e2ce34c35028bbd80c6874`。

`docker version`、`buildx version`、两种 build help 和 `buildx inspect default` 均退出0：Docker client/server29.8.1、server linux/amd64，buildx v0.37.1（commit `0b265a9f62db554fa9aba6dd19e1bd5704bc7d8a`），既有 default builder 使用 docker driver。`docker build --help` 明确支持原模板的 `--metadata-file`，buildx 所需 builder/load/metadata-file/iidfile/network/platform/pull flags 也存在。因此此项能力检查不要求改命令或重新打包；原9份 payload、manifest、小包 SHA 和 dated preparation JSON 全部保留。

此次只读观察没有 bootstrap builder、启动容器、传输项目包或凭据，也没有 pull/build/Registry 写或代理/路由变更。它没有证明固定 base cache 存在、删除 auth 后离线 metadata resolver 成功，或 Docker build/probe 已可验收；这些未知和执行前停止条件继续有效，下一批执行仍需上列精确离线范围授权。

## 下一批待授权执行范围

一次具体授权只覆盖本小包发送到 **AMD128** 原任务目录下新子目录 **`/tmp/riffoid-jhg46-image-20261017.AU613w/pi-resource-compat-v1`**、固定 base pull、断网构建、一次原 ID mock probe 与清理。子目录必须不存在，创建一次；禁止覆盖旧包/证据或在未知状态下改新目录重来。

1. **先只读核能力。** 核既有 `/usr/bin/docker`、`unix:///var/run/docker.sock`、default builder/buildx 和现有代理路由，与原 [AMD 证据](../evidence/releases/project-view-amd-offline-20261017.json) 对照。旧7897 listener 已清理，不能假设现仍可用。只核版本、help 和已有 builder 状态，不 bootstrap 新 builder、不暗改 daemon/relay/base/input。模板不支持或能力不满足就停，回头准备新的可审命令/脚本；不得执行时静默替换为另一种 buildx/OCI resolver 或丢 metadata。
2. **精确小包转移及核验。** 只发送上列30,515B/SHA的小包到该新目录。先核压缩摘要，再有界逐成员读取：恰9个指定普通文件、尺寸/摘要/权限和固定 FROM 全匹配；禁止 extractall、链接、未知条目和路径逃逸。
3. **固定 base 的短期仅 pull 凭据。** 同一既有 Cloudflare account/managed Registry，拟15分钟、`permissions:["pull"]`，操作仅限原 repo/digest。API 是 account registry 权限，不能误称 repo-scoped。凭据只经明确 AMD128 SSH 接收进程的 **stdin**；不进 argv/env/stdout/log。必要 Docker auth 配置仅在任务0700目录/0600文件内，password stdin，无 helper；一次 pull 后立即删除并验证不存在，终止原 receiver/relay，核 PID/listener释放。不传 Wrangler OAuth/provider token，不增 scope/订阅，不沿用旧 Chromium 凭据传输授权。
4. **一次 network-none build。** 仅 `context/`，固定 FROM、`--network=none --pull=false --platform=linux/amd64`，保留 iid、metadata、完整有界日志及 authoritative local image inspect。`--network=none` 约束构建执行网络，不证明 builder 的 metadata resolver 一定不发请求；pull/cache 也不证明删除 auth 后离线解析必成功。失败/未知就停，不扩大 auth 生命周期、换 base、插入 resolver 或重跑。包内通用 build 模板有 unsupported-stop 守卫；若需换成明确支持的 buildx 命令，须先准备新可审脚本/包与新 hash。
5. **一次同原 ID 镜像 mock probe。** 先持久化 intent/唯一 label/私有 cidfile，create一次后只 start原ID。固定读回的 local derived image；network none、uid10002、read-only、cap-drop ALL、no-new-privileges、默认 seccomp（不 unconfined）、pids128/memory768MiB/cpu1、tmpfs64MiB，仅只读挂载这份可信输入包。`env -i` 只设固定 PATH；没有 HOME/凭据/用户 workspace/端口。probe内部20秒、外层30秒、stdout/stderr各128KiB，任何丢弃字节/超时/坏JSON/错误mode/hash/uid/alias都失败。必须 `mode:image`、真实alias检查及全部12目标/SDK断言通过，不能用 source-mode替代。
6. **原 ID 清理和未知处理。** 保留原 wait/log/CID/intent，失败也销毁/删除同一容器。独立 inspect原ID，仅明确识别的 NotFound加该label空列表才算清理；空列表或未知错误不冒充404。lost ACK只按原身份只读核对，不第二次create/run、新key或删锁重试；不删其它容器、镜像或历史。Docker fixture资源限制不提升为 CF target资源可行性证明。

这个待授权范围**没有** Registry push、CF app image更新/新资源、gate/policy、真实 provider/Turn/Run/ProjectRuntime 或普通用户验收。实际新镜像 pin 与后续发布必须另据真实构建/注册表证据冻结；当前只是可审输入。现有无预算上限、不得新增订阅、确凿欠费通知规则保留。缺授权期间这些动作均未执行。


## 一次性 route/pull 操作件补充 — 2026-10-17

root 后续只读 [代理回执](../evidence/releases/project-view-trusted-pi-offline-build-20261017/proxy-readonly.json)记录于 **2026-10-17 11:20:18.066 UTC**（工具返回后的记录时间）：固定 Docker socket 正常；实际 `HttpProxy`/`HttpsProxy` 均为 `http://127.0.0.1:7897`，AMD loopback 返回 Linux `ECONNREFUSED`/111，当前没有 listener；本机既有 `http://127.0.0.1:7892` 在获准网络环境仅做 TCP 检查可达，没有发送外部代理请求。早先字段大小写和受限环境的误报没有作为权威证据。回执 SHA256：`2e09cf2060fc7dbcc8addc9a4771162cded285770ef658d6d880ea2d898ef22b`。这不证明未来 Registry 上游已通。

独立可审 [operations/EXECUTION.md](../evidence/releases/project-view-trusted-pi-offline-build-20261017/operations/EXECUTION.md) 和 [操作件清单](../evidence/releases/project-view-trusted-pi-offline-build-20261017/operations/operations-manifest.json)补齐此次最小 route/pull 段，**原9份 payload、30,515B 小包 `c92e672c…` 及其 manifest 全部不变**。新操作件 manifest SHA256：`05100f4a7c8aa2448b289d1525498dbd10542612873630e6b1cfd980dbb87512`；local operator SHA `4ef6352c4a48e52c8b1cd6ca1c0120d2b296c71851380b92d06ec8748fe934e7`，receiver SHA `caab07b759505ad31a9340201c803c03057a9e62537150a4d367b5f5bc73cc3b`。未来同一具体 grant 必须同时列小包、操作件清单和实际 reviewed packet commit，不能沿用 Gateway/Chromium 的旧授权。

该 grant 还须明确：本机单个自有 SSH 进程临时 `-R 127.0.0.1:7897:127.0.0.1:7892` 到 AMD128；接收进程在凭据生成前核实实际7897仅 loopback。所有 grant/target/source/hash/commit 守卫先完成，再只在本机内存读取现有有效 Wrangler OAuth，通过既有7892向固定 account/managed Registry **一次**请求15分钟、仅 `permissions:["pull"]` 的 credential（HTTP201）；返回四字段直接内存→同一 SSH stdin，不进入工具结果/参数/env/log/本机磁盘，OAuth 不传 AMD。过期无效即停；不自动续期、登录或加 scope。仅固定9b76 digest 的一次 pull；API credential 是 account registry 权限，操作件约束固定 repo/digest，临时通用代理并非 repo 防火墙。

receiver 仅任务0700目录/0600 Docker auth config 暂存 base64 secret，无 helper/`docker login` 密码 argv。pull 后 finally 删除并验证，终止原自有 SSH/receiver，独立只读核原 PID/start-tick 已退出、auth config 不存在及7897明确111且监听列表空。关闭管道或 kill race 不得跳过原身份读回和 unknown 记录；未知只核原 UUID，不新 token/route/请求重放，不删锁。build/probe 仍沿原9份合同逐条执行，不由此操作件暗含新增能力。

[本地 fake 检查回执](../evidence/releases/project-view-trusted-pi-offline-build-20261017/operations/offline-checks.json)记录最后一次 **18/18** 通过、`git diff --check` 通过；测试未读取真实 OAuth、生成/转移真实凭据、执行 SSH/relay、pull/build/container 或云写。独立审阅范围是操作件静态边界，mock 不替代未来真实路由/pull/清理证据。**本节全部真实动作仍未执行，下一批 grant 尚待明确批准。**
