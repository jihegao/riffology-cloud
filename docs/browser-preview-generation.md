# Browser Preview Agent 生成约定

日期：2026-09-15；2026-10-01 整合 #150 JavaScript 前端与已合并的 #122 compiler v0.1。#144、#150 的 Worker/前端资产及三个容器镜像已发布，普通用户完整验收仍待完成，当前版本以 `docs/release-readiness.md` 为准。#161 修复 Pi 可视化选择：新模型默认生成模型绘图代码，候选发布与用户重新测试分别记录。

平台真实注入入口是 `services/trusted-pi/release-candidate.mjs` 的 `resolveOptions().fixedSkills`，仍为一个 simulation skill；通用 Python/旧 SimPy/server Preview 政策保留。受信 Tool Bridge 提供 `project_install_preview_adapter`，把固定适配器作为一次有身份、幂等的项目写入；模型不再抄写长模板。候选测试核对固定策略、工具字节及 canonical server 实现。

## 保存资产与生成选择

新 interacting-agent/grid 模型优先 Mesa；Queue/lane 或用户明确 non-Mesa 用普通 Python 标准库。已有模型保持既有路径/profile 与 server Preview，除非任务要求迁移。Browser unsupported 不应诱发依赖安装、每模型部署或伪造 ready。

#161 的新模型默认使用模型自绘：Python 模型选 `python-canvas`，明确要求 JavaScript 前端时选 `javascript-canvas`。模拟的 grid/lane 空间与显示方式分开选择；网格模型无需使用共享 grid renderer。用户只需描述颜色、形状、图层或交互，不必指定 Canvas/renderer。固定 skill 提供可直接运行的森林火灾 `draw` 示例，并要求按实际状态调整颜色、每帧清屏以及背景→实体的绘制顺序。空地、健康、着火、烧毁应可辨认；同一 `run(config)` 快照仍是绘图和指标的来源。

共享 grid/lane 仅保留给没有视觉修改请求的现有工作模型，或用户明确要求的基本共享显示。共享 grid 只把 `group-b` 画成橙色，其余 agent 状态都为蓝色，不能满足任意状态配色。现有模型收到“用不同颜色区分状态”等要求时，在新 Revision 中添加绘图并切换显示模式；保持计算、参数、seed 和指标，除非用户也要求修改它们。历史包按冻结身份保留，不自动改写，不通过合并/重命名状态适配两色网格。

| 保存路径 | 固定约定 |
| --- | --- |
| `model/model.py` | 共享 `def run(config)`，config 仅 parameters/seed，导入时不执行模型，返回 model/snapshots |
| `model/run.py` | 由 `project_install_preview_adapter` 工具写入平台 canonical standalone adapter，服务器再次执行 model.run |
| `model/model-spec.json` | 既有严格 schemaVersion1，execution 指向 model/run.py 与 app/requirements.lock |
| `model/visualization.json` | 严格声明 schema riffology.visualization/v1、protocol riffology.visual/v0.1、renderer grid/lane/python-canvas/javascript-canvas、metricKeys；Python Canvas 另需 `model.py` 的 `draw` |
| `app/requirements.lock` | 原 schemaVersion1/packages JSON；Queue 空包，Mesa 固定六个根 |
| `frontend/manifest.json`、`frontend/main.mjs` | 仅 javascript-canvas 必需；固定版本 manifest 与受限 `render(context)`，组成严格七文件包 |

Mesa 源锁固定 mesa3.5.1、networkx3.6.1、numpy2.4.6、pandas3.0.2、scipy1.18.0、tqdm4.67.3。完整浏览器 wheel 闭包与 server native wheel 闭包由平台 profile 分别冻结；生成的 lock 不添加任意 transitive 最新依赖或 micropip/pip 指令。Queue server 保留历史 CPython3.11.14，Browser3.14.2，生成代码必须3.11兼容；Mesa 两端3.14.2。版本与数值结果对照由真实运行验收确认，不能仅凭同 Python 源码宣称完全一致。

平台先从相同保存 Spec 解析参数与默认值；模型不能 clamp/coerce/truncate 输入。seed 整数0..4294967295。steps/horizon 是普通 Spec 参数，播放速度只影响显示；声明 steps 时 integer/minimum≥1/maximum≤500，horizon 不偷换步数。每 frame 严格沿用 visual/v0.1，grid 不增加 torus 等协议外字段。metricKeys 为唯一非空 Spec.metrics 子集；末 frame 必须具有全部 Spec 声明指标。仅用户要求模型专用前端时生成受限 JavaScript；不生成 HTML、每模型 Worker、远程依赖或根级 visualization.json。

## JavaScript 前端边界

`frontend/main.mjs` 仅导出命名函数 `render(context)`，UTF-8 源码最多 128 KiB。静态解析拒绝 import、eval/Function、WebAssembly、网络、存储、DOM、Worker 与 postMessage。Python 仍负责实际计算和 trace；前端只读取冻结 Revision、package identity、参数、seed、当前 snapshot/index 及 pointer/select 事件，返回经过大小和数值边界检查的 Canvas scene。scene 不得报告模型成功、替换 Python 指标或生成 Verified Evidence。

代码运行在 opaque sandbox frame 内的锁定 Worker；frame CSP 与 Worker 限制隔离主站身份、token、浏览器存储和网络。旧 grid/lane/python-canvas v1 包继续使用其原固定资产。2026-10-01 主干整合重新生成 runtime 与 execution 清单，保留原版本字节；compiler v0.1 的冻结 Business IR/.simpack 仍走服务器执行，不能借新 JavaScript 前端宣称 Browser Preview 支持 compiler。

## Canonical server adapter 与发布材料

唯一实现负责人是 server 任务的 `services/run/model_run_adapter.py`；Trusted Pi release 内嵌其原字节静态快照和 SHA256 `b0c785d8c08838d9e416eb87aba1c6b5ce9d8b1d6d233cf2fec32de99a0ec7f5`，只供受信工具写入，不作为模型需要复写的 prompt 内容。工具经现有 Tool Bridge `write` 操作保存 `model/run.py`，不增加项目可写模板、文件系统权限或 Docker COPY 依赖。canonical adapter 更新时必须同步固定快照与摘要，并通过集成对照测试；不允许仅更新一个文件导致生成结果漂移。

adapter 接受服务器既有 --input/--output，独立从末 frame 取 Spec.metrics，NaN/Infinity 序列化拒绝。完整 summary.json 与闭 schema 的 trace-audit.json 均为必需输出且各自≤16 KiB；audit 固定记录 frame、time、queue_length、completed、abandoned、rejected、active、waiting。完整 trace.json 仅在单文件≤16 KiB、所有输出≤32 KiB时附带，超限不写部分 trace、也不截断模型计算；audit 超限则明确失败。平台既有结果/输出限额仍生效，完整 summary、audit 或 result 超限明确失败。浏览器 trace/metrics 不能作为服务器输入结果。重复 Verify 对 frozen Revision/参数/seed 使用原幂等身份，由用户显式可信按钮提交。

本地生成检查通过 `inspectGeneratedBrowserPreview(source, archiveBytes, kind, {registry})` 复用已保存 archive 的 compatibility validator，再检查 model/run.py 原字节摘要与保存 defaults。kind 仅 mesa/stdlib；默认 empty registry 明确 profile-unavailable，不借合成资产伪造 ready。该检查是调用方已授权、已保存文件的检查器，不自动发 LLM、执行 Python、保存 Revision 或触发构建。现阶段尚未接 central actor；实际保存/派生/read/Verify 由阶段2A完成。

## 证据边界与验证

固定 skill 要求通过项目工具执行有界 JSON/语法检查；依赖未装时只报告 import 执行不可用，不安装/联网/部署来“通过”。编译不是模型运行成功。保存成功与 package 构建失败分开报告，不能触发第二次 Agent Turn 修饰构建事实。

本地 preview 是未验证显示数据，既不是 Experiment、持久结果收据，也不是 Evidence。显式 Verify 由服务器重新计算；研究结论继续要求既有 baseline/intervention 组、合法 server Run/artifact、来源和旧版本警告，不伪造第二配置或测量数字。

定向命令：`node --test tests/m2/trusted-pi-release-candidate.test.mjs tests/m3/browser-preview-generation.test.mjs`、`node --check services/trusted-pi/release-candidate.mjs`、`npm run typecheck`。canonical adapter 的集成对照测试必须读取真正 server-owned 文件；缺文件直接失败，无 fallback/fixture/skip。在 server 基础提交集成前，只可报告其余选定检查通过，不能报告整个生成 suite 通过。

尚未覆盖：实际默认模型上游生成五文件、LLM费用/成功率、平台 saved/build 持久恢复、实际 package/read/iframe/UI/Verify、上线 release 模块装载一致性、普通用户 Mesa/Queue 全流程及发布/复制。后续 G3/G4 必须实际验证这些行为；当前固定政策与合成文件检查不能替代。
