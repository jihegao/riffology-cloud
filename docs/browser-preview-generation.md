# Browser Preview Agent 生成约定

日期：2026-09-15。阶段 2C / #64。状态：固定 release skill 和保存后生成契约检查已实现；真实 LLM 创建、自动保存/构建及普通用户验收待后续整链接线，本文不作为生成成功证据。

平台真实注入入口是 `services/trusted-pi/release-candidate.mjs` 的 `resolveOptions().fixedSkills`，仍为一个 simulation skill；通用 Python/旧 SimPy/server Preview 政策保留，新增 Browser Preview 约定直接拼入该固定内容。不是只新增一个项目 README 或用户可改的 skill 文件。已有 controlled host 测试确认固定内容进入最终 systemPrompt，专属测试核对实际 resolveOptions 输出包含新契约与完整 adapter。

## 保存资产与生成选择

新 interacting-agent/grid 模型优先 Mesa；Queue/lane 或用户明确 non-Mesa 用普通 Python 标准库。已有模型保持既有路径/profile 与 server Preview，除非任务要求迁移。Browser unsupported 不应诱发依赖安装、每模型部署或伪造 ready。

| 保存路径 | 固定约定 |
| --- | --- |
| `model/model.py` | 共享 `def run(config)`，config 仅 parameters/seed，导入时不执行模型，返回 model/snapshots |
| `model/run.py` | 原字节复制平台 canonical standalone adapter，服务器再次执行 model.run |
| `model/model-spec.json` | 既有严格 schemaVersion1，execution 指向 model/run.py 与 app/requirements.lock |
| `model/visualization.json` | 严格声明 schema riffology.visualization/v1、protocol riffology.visual/v0.1、renderer grid/lane、metricKeys |
| `app/requirements.lock` | 原 schemaVersion1/packages JSON；Queue 空包，Mesa 固定六个根 |

Mesa 源锁固定 mesa3.5.1、networkx3.6.1、numpy2.4.6、pandas3.0.2、scipy1.18.0、tqdm4.67.3。完整浏览器 wheel 闭包与 server native wheel 闭包由平台 profile 分别冻结；生成的 lock 不添加任意 transitive 最新依赖或 micropip/pip 指令。Queue server 保留历史 CPython3.11.14，Browser3.14.2，生成代码必须3.11兼容；Mesa 两端3.14.2。版本与数值结果对照由真实运行验收确认，不能仅凭同 Python 源码宣称完全一致。

平台先从相同保存 Spec 解析参数与默认值；模型不能 clamp/coerce/truncate 输入。seed 整数0..4294967295。steps/horizon 是普通 Spec 参数，播放速度只影响显示；声明 steps 时 integer/minimum≥1/maximum≤500，horizon 不偷换步数。每 frame 严格沿用 visual/v0.1，grid 不增加 torus 等协议外字段。metricKeys 为唯一非空 Spec.metrics 子集；末 frame 必须具有全部 Spec 声明指标。Agent 不生成 JS/HTML/每模型前端或 Worker，不把根级 visualization.json 混入出版路径。

## Canonical server adapter 与发布材料

唯一实现负责人是 server 任务的 `services/run/model_run_adapter.py`；Trusted Pi release 内嵌其原字节静态快照和 SHA256 `b0c785d8c08838d9e416eb87aba1c6b5ce9d8b1d6d233cf2fec32de99a0ec7f5`。这是固定 prompt 数据快照，不是第二套 adapter 语义实现。Agent 使用 project_write 保存同字节 model/run.py；无需项目可写模板或 Trusted Pi 新文件系统权限，也不增加 Docker COPY 依赖。canonical adapter 更新时必须同步固定快照与摘要，并通过集成对照测试；不允许仅更新一个文件导致生成结果漂移。

adapter 接受服务器既有 --input/--output，独立从末 frame 取 Spec.metrics，NaN/Infinity 序列化拒绝。完整 summary.json 与闭 schema 的 trace-audit.json 均为必需输出且各自≤16 KiB；audit 固定记录 frame、time、queue_length、completed、abandoned、rejected、active、waiting。完整 trace.json 仅在单文件≤16 KiB、所有输出≤32 KiB时附带，超限不写部分 trace、也不截断模型计算；audit 超限则明确失败。平台既有结果/输出限额仍生效，完整 summary、audit 或 result 超限明确失败。浏览器 trace/metrics 不能作为服务器输入结果。重复 Verify 对 frozen Revision/参数/seed 使用原幂等身份，由用户显式可信按钮提交。

本地生成检查通过 `inspectGeneratedBrowserPreview(source, archiveBytes, kind, {registry})` 复用已保存 archive 的 compatibility validator，再检查 model/run.py 原字节摘要与保存 defaults。kind 仅 mesa/stdlib；默认 empty registry 明确 profile-unavailable，不借合成资产伪造 ready。该检查是调用方已授权、已保存文件的检查器，不自动发 LLM、执行 Python、保存 Revision 或触发构建。现阶段尚未接 central actor；实际保存/派生/read/Verify 由阶段2A完成。

## 证据边界与验证

固定 skill 要求通过项目工具执行有界 JSON/语法检查；依赖未装时只报告 import 执行不可用，不安装/联网/部署来“通过”。编译不是模型运行成功。保存成功与 package 构建失败分开报告，不能触发第二次 Agent Turn 修饰构建事实。

本地 preview 是未验证显示数据，既不是 Experiment、持久结果收据，也不是 Evidence。显式 Verify 由服务器重新计算；研究结论继续要求既有 baseline/intervention 组、合法 server Run/artifact、来源和旧版本警告，不伪造第二配置或测量数字。

定向命令：`node --test tests/m2/trusted-pi-release-candidate.test.mjs tests/m3/browser-preview-generation.test.mjs`、`node --check services/trusted-pi/release-candidate.mjs`、`npm run typecheck`。canonical adapter 的集成对照测试必须读取真正 server-owned 文件；缺文件直接失败，无 fallback/fixture/skip。在 server 基础提交集成前，只可报告其余选定检查通过，不能报告整个生成 suite 通过。

尚未覆盖：实际默认模型上游生成五文件、LLM费用/成功率、平台 saved/build 持久恢复、实际 package/read/iframe/UI/Verify、上线 release 模块装载一致性、普通用户 Mesa/Queue 全流程及发布/复制。后续 G3/G4 必须实际验证这些行为；当前固定政策与合成文件检查不能替代。
