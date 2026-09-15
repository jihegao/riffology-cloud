# 多阶段实施与验收记录

日期：2026-09-15。基线：`40aee17`。当前阶段：G0 本地签收，G1 三线实施中。

集成分支：`codex/issues-20260915-integration`，工作树 `/Users/gaojihe/apps/riffology-cloud-issues-integration`。原 main 文档修改及旧 Mesa detached worktree 保留，不纳入实施提交。GitHub 当前为 5 个开放 issue。

| 槽位 | 分支 | 文件归属 | 状态 |
| --- | --- | --- | --- |
| A | codex/issues-g0-package | 新包 contract/schema/fixture；包契约文档 | G0 实施中 |
| B | codex/issues-g0-runtime | runtime 子目录协议/fixture；执行隔离文档 | G0 实施中 |
| C | codex/issues-g0-ui | web app/index/layout/CSS；UI 定向回归 | #65 实施中 |

## 冻结决定

- 源码为 `model/model.py`、`model/run.py`、`model/model-spec.json`、`model/visualization.json`；依赖锁 `app/requirements.lock`。与 issue 根级可视化示例的差异用于兼容已有发布/复制白名单。
- 沿用 parameters + seed；seed 为整数 0..4294967295，steps/horizon 是普通 Model Spec 参数。
- Verify 显式提交冻结版本与输入，由服务端重算；单次 Run 不直接成为 Evidence。
- G0 契约/fixture 不能替代真实 Pyodide、本地整链或云验收。

| 门槛 | 状态 | 剩余条件 |
| --- | --- | --- |
| G0 | 本地通过 | 线上 #65 签收仍待 G4 |
| G1 | 实施中 | 确定性包、隔离 runtime、server Mesa |
| G2 | 实施中 | Agent 约定已验证；saved 派生构建、持久 API、Workspace 实施中 |
| G3 | 未开始 | 非作者评审、真实本地整链、完整 check |
| G4 | 未开始 | 冻结发布、普通用户两模型、零执行窗口、资源释放 |
| G5 | 未开始 | #46/#37 账号/预算、账本、故障/复用验收 |
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

## 主控复核与环境记录

- 基线完整检查首轮因新工作树缺少 `.local/` 父目录导致历史测试 mkdtemp ENOENT；补齐 ignored 目录后重跑，日志 `/tmp/riffology-issues-baseline-check-20260915.log`。
- 已核对 `simulation_process.py` seed 与 Model Spec 参数名称/值类型，发现包与 runtime 初稿存在大小限制差异，已要求双方统一。
- 共享 alarm 当前合并 Workspace/Turn/Service/Observer/Simulation 五类唤醒。阶段 2 新增 build wake 必须覆盖所有调用点，防止任务结束误删构建 alarm。
- RevisionStore 现有 `serviceFiles` 可读取文件而不恢复 Pi Session；历史 resolver 必须基于可信保存索引与项目权限，不接受客户端对象路径。
- 已查阅当前 [R2 Workers API](https://developers.cloudflare.com/r2/api/workers/workers-api-reference/)、[Pyodide Worker](https://pyodide.org/en/stable/usage/webworker.html)及 [Worker CSP](https://developer.mozilla.org/en-US/docs/Web/API/Web_Workers_API/Using_web_workers)。条件写入失败返回 null 与写入应答丢失须分别处理；Worker 需在自身响应执行隔离策略。
