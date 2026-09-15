# 多阶段实施与验收记录

日期：2026-09-15。基线：`40aee17`。当前阶段：G0–G3 本地签收；G4可审阅发布材料已准备，真实执行范围与账号参数待确认；G5离线准备，G6初始来源兼容已实现。

集成分支：`codex/issues-20260915-integration`，工作树 `/Users/gaojihe/apps/riffology-cloud-issues-integration`。原 main 文档修改及旧 Mesa detached worktree 保留，不纳入实施提交。开工GitHub核对为5个开放issue；本轮未关闭issue。

| 槽位 | 分支 | 文件归属 | 状态 |
| --- | --- | --- | --- |
| A | codex/issues-m1-assets-preflight | M1严格资产预检已交回；只读审查受控发布清单 | 中央非作者审查通过；预检6/6主控通过 |
| B | codex/issues-g6-initial | 中央Browser/Workspace、initial来源、构建/Verify及面板已交回 | 主控28项来源/历史/Workerd及8项Chrome面板通过 |
| C | codex/issues-g3-acceptance | 整链driver/只读诊断及测试bridge已交回 | 作者整链通过；主控独立最终候选验收中 |

## 冻结决定

- 源码为 `model/model.py`、`model/run.py`、`model/model-spec.json`、`model/visualization.json`；依赖锁 `app/requirements.lock`。与 issue 根级可视化示例的差异用于兼容已有发布/复制白名单。
- 沿用 parameters + seed；seed 为整数 0..4294967295，steps/horizon 是普通 Model Spec 参数。
- Verify 显式提交冻结版本与输入，由服务端重算；单次 Run 不直接成为 Evidence。
- G0 契约/fixture 不能替代真实 Pyodide、本地整链或云验收。

| 门槛 | 状态 | 剩余条件 |
| --- | --- | --- |
| G0 | 本地通过 | 线上 #65 签收仍待 G4 |
| G1 | 本地通过 | 原生生产隔离/资源继承仍待G4，不能以翻译环境替代 |
| G2 | 本地通过 | 原子保存/initial发现、持久构建/API、物理资产及真实整链已通过；云签收待G4 |
| G3 | 本地通过 | 作者与主控独立两模型产品整链通过；最终完整check exit0；原生生产资源边界待G4 |
| G4 | 准备完成、待执行 | 发布review manifest/overlays、镜像模块/资产与回退材料已准备；账号预算隐私、managed digests及本次执行范围待确认 |
| G5 | 离线准备 | 真实账号/预算、账本、故障/复用生产验收未开始 |
| G6 | 未开始 | 三模型普通用户→审核→发布→新用户复制 |

## G0 后端契约签收及 G1 前移

集成后端候选：`b995430`。A 契约提交 f6c8761/5a4c8d5；B 提交 649d0b7/7a53584/8fa85a3。A/B 交叉评审，主控独立读取实际 diff 并执行 `node --test tests/m3/browser-preview-contract.test.ts`（4/4）、runtime protocol tests 和 `npm run typecheck`，全部通过。

评审修复：参数数量上限64、requestId严格字符串、统一输入限制；Worker script-src self 的动态 import 外送风险通过单bundle及不允许URL脚本来源的设计修正。真实浏览器隔离仍属于 G1，不作为 G0 实证。

#65 尚待多项目轮询和 pendingProject 租户绑定修复；主控已查看三视口长标题截图，未见横向溢出。根据计划 G0 允许 UI 修复受阻时不阻塞后端契约，G1A/B 从已签收后端候选 b995430 前移，阶段2B仍等UI正式集成。新分支 `codex/issues-g1-package`、`codex/issues-g1-runtime`；A 继续拥有非runtime包模块，B 继续拥有runtime子目录和固定资产脚本/清单。

#65 首次候选 ebe1089 已集成为 d9e72b0。主控独立 `node --test tests/m3/workspace-layout.test.mjs tests/m1/web.test.mjs` 50/50 通过，日志 `/tmp/riffology-g0-ui-independent-20260915.log`；专用多项目/跨tenant动态回归待作者补交。UI 上线签收仍待 G4。

基线 `npm run check` 最终 exit 0：1879 项，1873 通过，6 项按既有条件跳过；日志 `/tmp/riffology-issues-baseline-check-20260915.log`。该结果为基线验证，不能代替最终集成候选完整检查。runtime 专属 `*.test.mjs` 已加入正式 test:m3，纯包 tests 由既有 m3 glob 覆盖。

主控实际以无网络临时容器核对既有 Simulation 镜像 Python：`riffology-phase1-simulation:4159051` 为 3.11.14；Mesa 3.5.1/SciPy 1.18.0 官方 metadata 要求 >=3.12。因此阶段1C需新增独立版本锁定解释器/profile，保留旧SimPy与历史回放。来源：[Mesa](https://pypi.org/project/Mesa/3.5.1/)、[SciPy](https://pypi.org/project/scipy/1.18.0/)。

## G0 完整本地签收

#65 专用动态回归 bd6a9e1 已集成 af776ae，主控独立执行两项真实 Chrome 回归 2/2，通过实际自动轮询/SSE权限变更确认多项目与跨tenant修复，日志 `/tmp/riffology-g0-ui-two-regressions-20260915.log`。配合50/50 UI回归和三视口视觉检查，G0退出条件满足。UI文件所有权交出；阶段2B开始前统一重新从集成候选创建工作树。

G1C 已派发 `codex/issues-g1-server`（基线 af776ae），独占source/native执行、Python执行器/image、export/replay及通用server adapter与定向回归。A/B继续在G1 package/runtime树实施。三线开发不改变线上门禁与部署。

## G1A 基础能力集成

A 提交 16d60bf，主控非作者实际diff复核后集成为 db0fc01；独立13项contract/build测试与typecheck/diff-check通过。validator核对保存archive摘要、固定五文件、Spec/visual与依赖；packager保留原hash/source path且字节规范化；storage通过create-only写入与同identity GET补持久收据。receipt/reference目前为明确port，G2实际Durable接线仍未交付。empty registry默认拒绝profile，synthetic fixture不能生产ready。

主控冻结Queue server继续空锁3.11.14，Mesa独立3.14.2；Browser Queue在Pyodide3.14.2执行，两版本共享模型逻辑必须实际对照，不能静默升级历史空lock。Mesa源lock六包：mesa3.5.1、networkx3.6.1、numpy2.4.6、pandas3.0.2、scipy1.18.0、tqdm4.67.3；浏览器完整wheel闭包与CPython环境闭包分别冻结，源lock不引入micropip。

G1B主控预审发现host.load迟到写入、Spec参数默认值/范围接线和runtime资产身份覆盖transitive执行代码的问题，已由B独占修复；A槽位转为B非作者只读预审并等待最终资产registry接线。

## 动态槽位调整

A 完成 G1B 只读预审后，在固定资产身份最终冻结的等待窗口前移 G2C Agent 生成约定（依赖图仅要求 G0，非 G1 server 完成）。触发证据为 G1A基础代码已验收、runtime实际执行/资产收据仍在修复；最小改动仅 Trusted Pi 固定 skill/prompt 与专属生成contract tests，不抢占B runtime、C server adapter或阶段2A central文件。工作树 `codex/issues-g2-generation` 基线 a989599。完成后A返回G1真实registry接线。G2整体不因此提前签收。

线上状态未改变；签收时追加提交、命令、证据与明确缺口。

## G1 Server 基础与 G2C 集成

Server foundation 548da33 集成为 ed85c17，主控独立执行 adapter、server profile、native/export/replay 定向检查32项通过，typecheck通过。Mesa独立CPython3.14.2和八个hash固定wheel保留既有空锁/SimPy路径；执行结果与导出必须匹配可信解释器版本。共享 adapter 原字节摘要为 fa7987095bbc29f2c6d87e9b0f815415f88c9079ad7070fb7fe8b91e7ebf0898。simulation/host.ts 的profile拒绝写入改动由C单独拥有，G2A开始前交还。

G2C 01a8711 集成为2641189，主控实际generation与既有Trusted Pi release tests共9项通过。固定skill保留旧路径，并要求五文件共享模型、明确本地未验证与显式服务器Verify。该步骤没有接入自动build或调用LLM，不代表实际Agent生成验收。

A补丁1f51b4c集成为4c7f563；主控独立19项contract/build/generation测试与typecheck通过。Browser兼容性现在要求run.py与canonical adapter原字节一致，避免浏览器model.py与服务器自写入口产生不同指标。

服务器镜像本地构建成功，作者报告image sha256:1f9b5bbf70f74fde7764d7eb270e7616e9cf79a38c12418ddef8bb8bb1b1851f。512MiB独立导入探测通过；arm64主机翻译amd64执行时seccomp_load=-125，正常模型在preexec被拒绝，不能签收为真实运行。主控正在只读探测原生AMD128环境；生产fence不放宽。B正在最终资产冻结后重新执行真实浏览器验收，旧metadata和旧通过记录不作为最终候选证明。

最终runtime fd84602/b72ea97集成为2a6589b，作者26项真实Chrome/Pyodide与5项fixture测试通过；主控独立重建和真实验收运行中。两profile摘要为Queue 2a1fb75e77e1e004fa473deddd2ad98eb8f7bf2d22d697e5e280bd8d288fac28、Mesa 7d9463f7d7fcc383ed2a04731704e20098bad2438c2aedfbf6ff413a88440ce3。实际运行asset和host收据均由非更新构建严格核对，不能用旧收据替代。

AMD128原生x86但无Docker/替代container工具/免密sudo，无法无系统修改复现root与固定UID执行器。C测试专用outer fence f401db4集成为ce75b34，默认测试仍使用生产内层fence；显式本地翻译模式以Docker deny-network syscall规则和no-new-privileges证明真实socket/syscall EPERM，才使用既有translated marker。此证据是本地替代隔离，不证明生产内层seccomp。C作者两模型source重算/导出ZIP/Python replay已通过，主控独立两模型加旧五场景运行中；初次ZIP内存R2 shim漏arrayBuffer失败已修复并保留失败边界。

B槽位动态前移G2B，工作树codex/issues-g2-preview基线2a6589b。计划明确允许面板先基于G0契约fixture开发，G1仍等待主控真实验收与registry签收。B独占web面板、相关UI和新增execution-static Worker/config/materializer；A拥有app/Gateway授权资产路由与central build/Verify。G2最终不能以fixture面板签收，仍须实际API和持久恢复证据。生产独立执行站点/部署均未进行。

主控最终独立验收：26/26真实Chrome/Pyodide、5/5 runtime fixture/schema、7/7真实Docker（两模型与既有五场景）、22/22 contract/build/generation/production-registry，typecheck通过。实际检查image identity、两server receipt的版本/exit/摘要和研究ZIP真Python replay均matches=true；实际查看Queue/Mesa截图。证据集中于`.local/issues-20260915/g1/`（ignored），主控日志有SHA256SUMS，浏览器实证另含请求/CSP/截图摘要。此处真实执行仍使用明确的本地Docker outer替代fence；内存R2 port导出不是Gateway/R2云端整链。C继续补Browser/server同配置seed7完整trace对照后再退出G1。

可信生产registry 70c7d00集成为b9f81cc，仅静态平台清单可注册verified-platform；正式两模型测试使用真实tar archive摘要→validator→确定性packager，不能把runtime自建fixture的拼接摘要冒充保存archive。A进入G2A，工作树codex/issues-g2-orchestration基线b9f81cc，拥有central journal/store/build/Verify/Gateway/alarm所有调用点。API冻结为只读build view/package/Verify状态与显式Verify提交，GET不写discovery、不启动计算。saved journal+discovery intent+build逻辑wake+物理alarm要求同事务，实际重启且无页面后台恢复仍待实施验收。复制模型initial reference尚无savedTurn，Browser派生支持缺口单独保留，不伪造checkpoint或继承源项目权限。

C额外实际entrypoint探测发现amd64翻译exec后新解释器RLIMIT_AS为(-1,-1)，此前direct setrlimit→依赖导入探测不能证明child继承512MiB。本地outer结果仅签UID/网络/生命周期/同源计算，不签硬AS内存隔离。生产runner不为翻译环境跳过/放宽限制；默认native资源断言仍保留。可另验Docker cgroup resident cap并标为替代边界，原生生产资源继承须G4实证。失败stderr已由C保存在`.local/g1-server-mesa-isolation-debug.log`。

主控核查当前[SQLite storage事务API](https://developers.cloudflare.com/durable-objects/api/sqlite-storage-api/#transaction)，G2A使用异步storage.transaction覆盖journal/intent/wake/物理alarm，内部journal operation保持同步且无外部I/O；transactionSync不能承载异步setAlarm，sync flush不能替代原子关系。具体rollback/eviction/alarm证据仍待实际Workerd测试。

## G1 本地签收

同输入f14c79f集成为3009c0a；主控独立再运行两模型2/2通过。测试使用B五文件构建真实tar→生产registry validator/packager→实际Docker native→完整同源trace→ZIP真Python replay；seed7及完整参数与真实Browser记录一致，两trace exact deepEqual，无浮点容差。Queue在3.11.14/3.14.2完整trace相同；typecheck通过。原spike protocol/fixture UI另外4/4通过（显式CHROMIUM_PATH使用已安装Chrome；缺Playwright cache的首轮属于环境启动失败）。主控日志与摘要集中于`.local/issues-20260915/g1/`。

G1本地门槛满足：确定性生产包、固定离线runtime、两profile共享renderer、服务端同模型入口及同输入对照。此签收保留前述local outer/资源继承边界；不代表G3实际产品整链或G4普通Agent与原生生产隔离验收。G2A/B继续动态并行，C收尾Mesa实际entrymarker后的deadline/cancel，并转G3整链验收准备。

Mesa live-child边界fcc9ba7集成为3f1d6b6，主控独立3/3通过：实际child marker后取消/deadline、停止UID10001进程树、重复start不复活。translated测试另配置512MiB resident cgroup并实际768MiB分配OOM(exit137/oom_kill1)，根进程仍能以原seal receipt reconcile；此为host cgroup边界，仍不签AS继承。证据见g1/server-boundary-independent与日志摘要。C已交回所有server实现文件，转codex/issues-g3-acceptance独占新增整链driver/tests准备及非作者publication兼容审查。

## G2 持久发现核心

752b62d集成为86147ab。主控实际diff复核后独立35项store/shared-alarm/router及真实Workerd检查通过，typecheck通过。saved journal、discovery intent/index、第六逻辑wake与物理alarm同异步事务；setAlarm后注入失败整体回滚，重启无页面请求仍实际收到alarm。六处alarm合并保留buildwake，maintenance最后推进build域。

核心尚未接生产buildhost/API/constructor，不能称自动ready。主控审查发现discovery重算仅考虑pending discovery会遗漏已有profile retry，已要求A下一提交聚合两类wake并覆盖未来checkpoint时间的新保存，不推迟已有build。G2签收仍待ready/unsupported/failed持久状态、R2补收据、历史权限/Verify与实际UI整链。证据集中g2/discovery-independent.log及SHA256SUMS。

## G2 静态交付、面板与 G3 准备

B 的 d3f9862 集成为 8fc51f2，407bc0f 集成为 de6c230。主控独立严格 materialize 固定清单的43个URL，实际生成字节的交付/CSP/篡改拒绝检查3/3通过。此检查使用文件资产 binding port，尚非真实 Gateway ASSETS 或浏览器 Worker 整链。独立站点 Worker 无项目源码、token 或动态执行能力。历史 profile 对应旧 host bundle 的版本映射仍在补充；只有保留资产不能证明旧运行时可恢复。

面板区分 GET 恢复、浏览器 Run/播放与显式 Verify，按 tenant/project/package 保存参数，按原请求身份恢复未知 Verify。主控已要求补充回执身份严格相等与显式失败构建重试，不以刷新伪造恢复。正式检查入口纳入 execution tests 与新面板语法检查；实际 API 接线和三视口产品验收仍待完成。

C 的 64e6572 集成为 a04368f，主控真实 Workerd/Gateway/D1 登录与邀请检查1/1通过：owner 200、跨tenant404、无签名或篡改cookie401。仅认证 fixture 写入身份/邀请；未插入模型、ready build、Experiment 或 Run。诊断实际 Sandbox SDK 通路可用，但 Workerd 拒绝外部出站不足以隔离容器内部 loopback/Unix listener；该观察不签G3。C 正在一次有界测试中验证 ARM64 原生内核 helper 对翻译项目进程施加连接限制，须独立重跑和明确测试镜像边界后才作为本地替代隔离证据。

132b026 集成为 f9f0bca，主控严格重建与4项固定静态交付检查通过，typecheck通过。8dca40e 集成为 af2fb75，主控5项真实Chrome面板fixture通过。构建重试的未知回执恢复和再次耗尽后的新请求仍在修补；这些测试不替代产品API整链。

A rebased 提交 d650e8b/f628835/d35a139 集成为6c4f3de/3a3e6fa/e4e4b95，生产Workspace/Gateway接口可供C进行真正接线。主控独立8项build-host与Workerd检查通过、typecheck通过：真实tar生成包，先持久reference再条件写R2；丢失receipt可在重启后按原object补回；当前registry变更后使用已冻结平台snapshot；unsupported不被另一profile失败覆盖。host tests 的bucket仍为port，真实Workspace后台ready/R2与Gateway权限整链待实际验收。B非作者评审发现第三次rearm后crash可能造成第四次构建，A正在修复；平台旧host SHA传递与combined ASSETS也在补齐。主控证据归档于`.local/issues-20260915/g2/`，含日志摘要。

## G3 本地替代内核隔离签收

C 的8f786c7集成为d1aad05。主控实际审查freestanding ARM64 ELF构造、BPF syscall限制、UID检查、shell bridge与诊断清理，独立重建并通过真实Sandbox SDK探测。主控派生测试镜像为`sha256:14ad4bb7ac8558c482f1abb21bf8e5183d99e7281ea1df774df0872475c4d574`，其原基镜像身份、helper原字节摘要与编译器版本保存在g3/helper-independent。

真实SDK前后均200；child UID/GID10001、groups空、NoNewPrivs1；ARM64内核原始io_uring三调用先返回EPERM，再执行翻译CPython；loopback/Unix/external TCP/UDP connect与UDP sendto全EPERM1，两rootlistener零arrivals。此为独立测试镜像局部隔离签收，不是生产x86镜像证明。guest AS仍无限；Queue空锁经monitor sys.executable的实际bridge路径和完整SimulationHost结果仍待验证。线上原生隔离/资源继承门槛保持G4。

## G3 两解释器路径与动态前移

39e0aa2集成为0a82b17。主控独立重建派生Queue-safe测试镜像`sha256:2fb3173593395a22c276395cf93f01211853ecbe127495ae40349a45a781bae5`，真实Sandbox SDK／生产SimulationNative两解释器路径通过：Queue3.11.14、Mesa3.14.2，完整chunk上传/control/start/observe/fenced seal与root收集proof产物；五类网络操作全EPERM、root listener无arrivals，重复start得到同停止收据。helper与UID0测试hook原字节在实际SDK读取中匹配本次build provenance。证据g3/native-paths-independent含image、两结果与日志摘要。此处仍为有限隔离诊断，不替代真实Gateway持久Run整链或原生生产AS继承。

发布只读设计e319372集成为e0fef6b，见[复制兼容设计](browser-preview-publication-compatibility.md)。主控选择最小方向：从复制项目可信initial source派生新项目包，显式记录新运行时身份并冻结；不自动承诺继承原发布runtime，不扩展catalog receipt字段，不伪造saved Turn。该补丁尚待实施与G6普通用户路径验收。

Retry回执056e5dd与资产并发2147a0a已由主控独立6项／7项面板测试验证；未知请求仅GET恢复、后续耗尽需新的显式intent，固定资产最多2个并发读取且保留完整顺序。B新增审查发现Verify新提交缺少ready admission，A正在按原Simulation准入补齐；旧结果的maintenance读取保持可用。

B完成当前G3只读审查后，空闲槽位前移G5离线固定任务fixture：六类任务×三重复、固定seed/对照、故意失败输入及验收引用。触发为B实现与审查已交付，A/C仍推进G2/G3；不抢占central文件、不调用provider、不部署。账号、模型、rate card、预算/隐私与授权仍未选定；离线fixture不是18任务质量实证。

## G2 最终接口复核与 G3 实际资产链

A a6a4a6f 集成为0aec37d，主控17项定向检查与typecheck通过：新Verify采用ready准入，历史读取保持授权；保存源在异步边界重新校验；重试最多三次且崩溃恢复不产生第四次构建；历史版本使用自身冻结profile及对应交付模块。面板并发与未知回执恢复的独立检查为7项，仍不替代实际产品整链。

主控独立实际Miniflare ASSETS控制：最小Worker和真实Gateway，在虚拟origin与实际匹配127.0.0.1监听端口下，dispatchFetch及物理HTTP均得到host module 200/40517字节。端口本身导致失败的猜测已撤回；A此前不同hostname/listener探测尚未确证原因。combined资产目录、当前web摘要及预检补丁待作者提交与主控复核；不得用浏览器route桥接代替物理HTTP产品链。

C两模型真实部分链已增加重启后直接R2后台轮询，先于任何Gateway/Workspace请求；全部五文件字节及冻结runtime/profile/delivery对照通过。full browser→Verify→native→持久Run→导出尾段仍在开发，未签G3。

B c243014集成为29d8857，主控独立两项离线fixture检查通过：三个项目各六项依赖顺序任务、九组配对seed，固定故意失败与修复字节，有限队列守恒/容量/确定性检查。账号/模型/预算/隐私/授权仍为null；provider调用和新增持久项目均为零。正式test:m3纳入该测试。B转初始复制兼容的只读实施设计，central文件继续由A独占。

已形成G4候选发布范围文档；只读Cloudflare元数据确认账号workers.dev子域为jihe-gao、候选独立执行Worker名称未占用。没有启用站点、改DNS、部署、读取后宣称当前门禁通过或发起模型调用。候选源码/生产镜像/预算与回退须在G3完成后冻结。

## G3 资产签入与独占交接

A 367301e/a8d0d9b集成为9e331fb/a12b31e：五配置ASSETS指向verified combined目录，Gateway允许面板module，预检绑定当前web所有字节及平台静态清单原摘要、profiles/versions/delivery/count。作者40资产实际HTTP与真实Chrome模块import、44项preflight及typecheck通过；主控最终组合检查45/45通过（1项真实40资产HTTP/Chrome与44项preflight），typecheck通过；证据g2/assets-final-independent及SHA256SUMS。

中央文件独占A→B交接，B从a12b31e隔离新分支实施可信initial-copy source union，保留legacy saved identity与runtime；不得伪造checkpoint或在GET新建discovery。A停止中央写入，转C完整driver/tail只读审查；C只拥有新增整链driver/testhelper。触发为G2A收尾已提交且复制来源缺口仍阻断G6。G3完整check须在该兼容补丁集成后最终执行，当前真实saved产品链仍单独验收，不等待扩大测试范围。

主控实际查看Queue1600/390截图，发现390宽按钮被压成五列、中文逐字竖排；不能仅凭无横向溢出签视觉通过。A额外获得workspace.css单文件所有权做局部可读性修复；B只写JS初始来源标签，避免CSS冲突。G3 Queue已实际计算，当前harness60秒释放等待不够生产360秒守卫，修正测试等待并按原身份保留/核对释放证据，生产策略不放宽。

## 主控复核与环境记录

Issue逐项关闭条件与本地/线上边界见[签收矩阵](issues-acceptance-matrix-20260915.md)，与本记录同步维护。

- 基线完整检查首轮因新工作树缺少 `.local/` 父目录导致历史测试 mkdtemp ENOENT；补齐 ignored 目录后重跑，日志 `/tmp/riffology-issues-baseline-check-20260915.log`。
- 已核对 `simulation_process.py` seed 与 Model Spec 参数名称/值类型，发现包与 runtime 初稿存在大小限制差异，已要求双方统一。
- 共享 alarm 当前合并 Workspace/Turn/Service/Observer/Simulation 五类唤醒。阶段 2 新增 build wake 必须覆盖所有调用点，防止任务结束误删构建 alarm。
- RevisionStore 现有 `serviceFiles` 可读取文件而不恢复 Pi Session；历史 resolver 必须基于可信保存索引与项目权限，不接受客户端对象路径。
- 已查阅当前 [R2 Workers API](https://developers.cloudflare.com/r2/api/workers/workers-api-reference/)、[Pyodide Worker](https://pyodide.org/en/stable/usage/webworker.html)及 [Worker CSP](https://developer.mozilla.org/en-US/docs/Web/API/Web_Workers_API/Using_web_workers)。条件写入失败返回 null 与写入应答丢失须分别处理；Worker 需在自身响应执行隔离策略。


## 最终集成与独立签收推进

中央 initial 来源7aafb39/eae239f/473a212已集成为b0c66b2/c323979/2a68edc；A实际非作者diff审查通过。主控独立28项定向检查含两项真实Workerd/SQLite回滚与无Turn自动重启打包，以及8项真实Chrome面板回归通过。来源仅在真实确认ready时持久发现，不伪造savedTurn；历史读取、Verify输入与原始ModelContent引用逐项绑定。此实现不代表普通用户审核/发布/复制G6已通过。

正式检查发现两项旧M1 fixture/预检未适配新实际模块与组合资产。98db1a9加入实际browser-preview.js及只读空态API；e703386只允许冻结组合目录、绑定与worker优先次序，实际执行额外只读核验字节收据。主控预检6/6通过，不放宽超时或静态目录约束。最终实施候选526eee7的主控真实G3与npm run check已启动，结果待记录。

文档同步仅覆盖本轮新增14篇文档；同步记录按上次SHA检测原工作树是否被另行修改。原main的5篇已修改跟踪文档保留，不覆盖、不暂存。G4本地生产Pi镜像及实际装载模块已准备，云账号预算/隐私/时限与本次发布范围未授权，未部署。


## G2/G3 本地最终签收

最终实施候选bafc48a（后续仅文档同步）。主控完整`npm run check` exit0：1971项、1960通过、11条件跳过、0失败/取消，日志`/tmp/riffology-issues-final-check-repaired-20260915.log`。11项为既有Python协议opt-in1、既有Docker5，以及本轮新增两模型真实同输入2/Mesa边界3 opt-in；真实执行单列在G1/G3证据，不将默认跳过冒充执行。首轮M3失败日志保留，根因两旧Chrome fixture漏供应实际browser-preview.js；bafc48a仅补真实模块和owned GET空态，作者20/20、主控最终完整检查通过，无放宽deadline或skip。

主控G3候选526eee7实际整链exit0/fullGate true；执行开始后的生产代码未变化，只增加fixture、只读发布准备器及文档。Queue/Mesa各nativeStart1，真实私有R2/历史Verify/完整源码trace/ZIP replay/身份与权限均通过。冻结localWindow的新计算增量0、execution Cookie0，六视口截图经非作者复核。保留生产360秒guard与quiet期，逐historical quota.lookup匹配停止确认，两native/初始化均释放，occupied0。证据`.local/issues-20260915/g3/research-chain-independent/`含实际结果、源码摘要、截图、ZIP、日志、SHA256SUMS。ARM64测试bridge与saved-source fixture不是G4普通Agent/x86原生资源证明。

G0–G3本地门槛已满足。G4发布清单新增只读生成器/严格校验3/3主控通过，生成review overlays不修改原生产配置；预算/账号/隐私/null保持blocked。G5离线18任务及runtime-reuse方案准备完成；G6initial可信来源实现已完成，但普通用户三模型→非作者审核→发布→新用户复制未执行。当前5issue仍未关闭，未部署或新增收费请求。

## G4 显式授权后的发布前进度

按当前用户授权仅执行G4，预算/数据/时间窗见计划末节。新增服务端持久预算提交5667dc8、原生attempt计数5964e5a及scope兼容3118ac9；主控43项定向检查通过。attempt表示调用前计数而非成功执行回执，缺历史instrumentation返回unknown，不伪报零。生产镜像remote amd64 leaf：Pi025a80a809ab2fcf7bfac1dbd2a1ab2c225753fa4881514949cecfd408b7426e；Simulationbdceaa26a9dd4ecf82182327ea6ca07f3e968c4b132d79adf3c0cfac6a58fcf2。保留实际Tools b21324f5而非checked-in旧6e1c51f9。配置dry-run通过，未部署应用候选，未启动普通用户任务，2小时deadline仍null。G4专属R2诊断7d/验收30d规则已PUT后GET验证；原默认multipart规则语义保留。完整正式检查将在最终交叉审查修复集成后执行。


## G4 受控准备实测更新

已按本次授权配置不可重置的 US$20/Turn US$5/32上游/16 Run/首次接纳后2小时时窗，仅使用既有普通测试账号与 operator。应用候选以所有任务门禁关闭发布；独立浏览器执行 Worker 已发布并核对固定资产字节。生产 amd64 Pi 与 Simulation 镜像已上传并独立核对远端 digest，五个容器应用实际 rollout 已完成。

普通用户任务尚未接纳，权威窗口 startedAt/deadlineAt 为 null，模型请求和 Run admission 为零。真实 Cloudflare SDK 固定内容探针核对六个模块字节、Adapter 与生成契约通过；云端实际 Pi 实例使用预期镜像且 destroy 后 running=false。两次完整分页库存观察均为238个 inactive、活动实例0；临时探针删除与缺失确认仍在收尾。该探针不调用模型，不代替普通用户 G4 验收或 native Run 资源边界证明。

生产源码1308caa完整正式检查：1994项/1983通过/11条件跳过/0失败。为可靠验证真实构建失败恢复，正在补充仅限本次两个新合成 workspace、最长120秒且自动到期的 private build HOLD；无公共 HTTP 路由，不伪造失败，不影响任务预算。集成后重新冻结生产源码并完成检查，随后才开启普通用户任务。G5/G6仍未授权，任何issue尚未关闭。


## G4 已实际开窗与首轮发现

最终生产源码0748fb975eec6256992a82a1812c93c2d7c77f52正式检查2000项/1989通过/11条件跳过/0失败，HOLD非作者审查及主控7项定向检查通过。应用与独立执行Worker均实际100%发布此source tag；新增专属工作区HOLD配置不重置父级时窗。首个普通用户页面创建合成项目的权威接纳时间为2026-09-15T14:57:10.322Z，到期2026-09-15T16:57:10.322Z（北京时间22:57:10至次日00:57:10），到期停止新任务。

普通用户Mesa首轮Go Turn已实际完成、保存Revision da45780f1433b91eee2dc9c1da127d358afc80ea737b019cb434338ede90793e，自动包ready；包真实HTTP字节14489、SHA f33a6108a088f7957eb3fbccf96c769bd9774fc022e5c158fa2d27e36d3215e4。固定wrapper字节匹配fa798709…；四个模型调用已在预算账本recorded（该次快照保守计费US$0.0131361，非账单证明）。首轮120秒HOLD先到期，已RELEASE，源文件从未删除，不能记作构建失败恢复通过。

非作者审查实际生成源码发现其只使用random/字典居民，没有Mesa Model/Agent；依赖锁与Mesa profile不足以证明真Mesa。还发现ID随位置重编号、初始化偏置与number参数整数边界不一致。已通过普通用户新Turn修正真实Mesa机制和上述问题，结果待核对；原Revision保留历史，不把旧stdlib模型签作Mesa。第二个普通用户合成Queue项目与Session已创建，尚未将未核对的新模型或浏览器/服务器链签收。

SDK固定内容探针已停止、完整库存稳定inactive、临时Worker已删除且实际缺失/主应用回退持续30秒确认。已将SDK脱敏准备证据写入本次R2 30天前缀并独立下载对照（2930bytes，SHA495d341834648c638e4e46f08c60bc25467e5ab35b87dccf4a5829dd33d7756a），临时镜像仓库凭据已移除。G5/G6未授权，无issue关闭。


### G4 真实运行中的发送前阻断与原键恢复

- 截止固定为2026-09-15T16:57:10.322Z（北京时间次日00:57:10.322）；不会延长窗口。首Turn7次Go调用均有provider usage/requestId，保守费用US$0.0265521，服务端Run0。早期4调用快照不代表最终总数。
- Mesa修正UI捕获后guard失败，原请求没有dispatch fence/receipt、服务端没有该Turn，独立只读guard重新通过。主控保留捕获键/body，以普通用户认证API同键恢复202；原UI标记发送前阻断，恢复标记API，不宣称其UI成功。
- 执行器独立审查定位全局proxy环境删除和30秒子进程deadline两项可失败路径；尚未证明本次精确原因，正在补私有stderr/阻断阶段记录。产品预算/时限不放宽。
- 首模型实际stdlib而非Mesa是明确验收失败；正在通过新Turn生成真正Mesa Model/Agent，原Revision继续保留。首HOLD过期且未故障注入，不算构建失败恢复。Queue初始计划只离线材料化；本地重跑、Verify、比较、ACL、最终释放和G4签收仍待实际证据。


### G4 正确Mesa修正与配置范围固定

真实新Mesa包通过独立离线源码/执行审查，root R2五文件逐字节核对通过；实际本地Browser/nativeRun仍待执行。Queue首Turn普通UI202接纳。operator修复5737e2f经非作者审查、root轻量失败证据测试1通过与两module语法检查，生产源码0748与固定模块字节不变。应用唯一version3ba32488-1717-49b5-a243-2736f160eb9e允许两个实际workspace私有HOLD，独立源etag与14项预算不变；不滚动容器。临时Mesa控制Worker已释放并删除，API独立确认不存在、route404，未发生源码故障。12次真实模型调用保守US$0.0592862全部recorded，serverRuns0。


## G4 最终受控执行收尾（2026-09-16）

G4本次受控执行结束；#64普通用户主链通过，#65与全部线上负向场景未完整覆盖，issue未关闭。冻结生产source924803b，正式2002/1991通过/11跳过/0失败；三组实际零执行local窗口、七Native Run与严格replay、三个来源verified/scientificunassessed claim、真实source-unavailable恢复和最终quota0/259inactive已核验。30/32上游、7/16Run，保守US$0.1638495，UTC16:39:45提前关闭新任务门禁，原2小时/预算fence不重置。脱敏副本7/30天，实际远端94/94摘要校验。G5/G6未授权。详见[本次G4线上记录](g4-online-acceptance-20260916.md)。

此前0748/7或12调用/Run0/尚待验证条目为历史快照，不是最终当前状态。生产source924803b，operator host a4f367c；主应用实际门禁关闭版本fc3c6a9d，执行站点10a5428b，模型/时窗/容量不升级。完整当前证据、费用边界、真实恢复、旧版验证与未覆盖项见链接。

本地临时集合清理补充：A/C实际副本已删除，Root owned auth已删除、临时控制Worker/cap已失效。B目录递归删除被自动审批拒绝，Root/B剩余目录未删除，需明确许可；不宣称全部本地集合已清除。远端7/30天生命周期与94/94校验完成不受影响。具体两个目录及边界见[G4记录](g4-online-acceptance-20260916.md)。

用户随后以“ok confirmed”明确批准这两个目录清理；主控携带该确认及固定路径尝试一次，PreToolUse仍以 `heredoc.python:shutil_rmtree`（CRITICAL）拒绝，命令未执行。主控未重试或绕过，独立核对两个目录仍存在；当前阻碍是自动审批规则，不是缺少用户授权。需手动清理或由管理员通过正式机制处理规则后再执行。

用户报告已手动删除后，主控独立核对Root本轮采集目录和B脱敏副本目录均不存在、无残留符号链接，本轮两处目录清理已完成。现有账号/profile/operator、产品业务对象及预算fence未纳入清理。最终交付回执已更新为localDirectoryCleanupCompleted=true，实际R2 PUT及独立GET字节一致：2570字节，SHA256 `c4200f881d01a5687f821edeedec4d44fb9052b523667f4696989d0f6a634fa5`，沿用evidence前缀30天生命周期；原诊断7天/验收30天归档保留策略不变。此前审批阻断与待清理记录为历史状态，已由此次用户清理和独立核对解决。G5/G6仍未启动。

### 下一窗口执行准备（2026-09-16）

[G4收口与G5执行提案](g4-closeout-g5-execution-proposal-20260916.md)已形成：G4剩余线上门槛单列；G5 #46三项目18任务/39研究Run、147上游建议上限；#37两项目22Turn/168上游保守上限/研究Run0。两窗口各US$20、每TurnUS$5、首admission后2小时是待批准候选，需真实profile费率证明最坏预留满足预算。#46现有OpenAI Responses/Gateway/platform-BYOK契约不能直接沿用G4 OpenCode通道；#37第二tenant、暖overlay与物理身份/释放观测driver仍需补齐。本次只完成只读分析和文档准备，没有云发布、模型调用、新任务/Run或G5/G6线上执行。

### G4/G5执行准备实现进展（2026-09-16）

三独立subagent实现已集成：#46离线调度compiler、#37只读collector（缺可信暖租约/物理事实，验收保持blocked）、G4原生Run可信preexec观测。主控typecheck与54项定向测试通过；未部署/付费/新Run，线上缺#46生产配置与第二授权测试账号。详情见[G4/G5提案最新进展](g4-closeout-g5-execution-proposal-20260916.md)。这些部分准备不代表完整live driver或issue关闭，原线上门禁和预算fence未重置。

### 账号补齐进展

用户提供的OpenAI密钥只读鉴权HTTP200、Luna可用；专属Gateway已创建并独立GET核对，未有推理调用。保守147/168调用预算分别US$10.3563264/11.8358016，满足各US$20候选。用户随后授权第二测试用户`jihe.gao@theidsa.org`，其真实userId/tenantId尚待登录核对；Gateway Run token与独立G5服务端窗口门禁仍待落实。参见[G5账号/Gateway核验](g5-account-gateway-readiness-20260916.md)。旧G4fence和门禁未重置。

#37实际文件journal已集成5373071：原intent永久保留，独立ACK/terminal reconciliation、wx锁及文件/目录fsync；重启与并发测试验证未知提交不能自动重发。它只证明本地持久化身份，不提供云端native authority，主runner仍保持blocked。独立审查及服务端全局窗口守卫继续进行。

随后已独立核验Gateway token HTTP200/active（仅token状态，不证明Run权限或代理调用）。G5 guard与修复已集成aa32bfd/0cae23d；journal三账本fail-closed修复集成47d656d。主控当前typecheck及32项定向测试通过，含2真实本地Workerd，0失败/跳过。未绑定任务、费用unknown、三账本未齐均不放行；B强制distinct tenant及user。共享生产接线/部署尚未完成，推理0/新Run0/未开始2小时时窗。此前token/第二邮箱缺失记录为历史状态，实际principal核对仍待完成。
