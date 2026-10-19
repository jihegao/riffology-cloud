# Riffoid IR Plugin

Riffoid 多层 IR Plugin 的使用约定、接入说明与复杂系统建模仿真白皮书。

当前实现版本为 **0.3.1**，开发基线为 [v0.2 功能合同](docs/functional-requirements-v0.2.md)。包含可被 PI WEB 加载的浏览器插件、Pi extension、共享建模 skill、真实编译适配、浏览器 Plan 执行器及运行记录。v0.1 的 `/model` 设计已由首版的 `/sim` 和四个工具取代。

固定验收使用合成飞机保障 B1：`aircraft-support-pack/v0.1`、`legacy-minute-v1`。当前运行时另支持七日以内的跨日保障、飞行暴露指数故障与固定维修时长；具体约束见领域能力说明。浏览器结果为 local/unverified；不代表真实保障业务已验证。Riffoid 的固定包工具、Project Tools CLI 与项目页面入口随包提供；宿主实现、部署和双端实际验收分开记录，见 [接入说明](docs/riffoid-integration.md)及[验收记录](docs/acceptance.md)。

上述范围是当前可执行能力，不限制后续领域包开发。用户要求 MTBF/MTTR、多日任务或其他缺失能力时，Pi 应进入[领域包开发流程](docs/domain-development.md)，检查并补齐编译/浏览器支持后继续模型，不能仅因超出 B1 拒绝任务。

## 本机安装

需要 Node.js ≥22、Python ≥3.12、PI WEB ≥1.202610.3、Pi ≥1.3.0。插件本身无 npm 运行依赖，直接发布 ES modules。

在具有 `sim-engine-compiler==0.1.0` 与 `simpy==4.1.1` 的 Python 环境中，设置 `RIFFOID_IR_PYTHON` 指向其解释器即可。也可从合同固定的 wheel 准备可移植编译 SDK（macOS 不运行其中的 Linux 原生扩展）：

```sh
python3.12 scripts/bootstrap-compiler.py --wheel /path/to/sim_engine_compiler-0.1.0-cp312-abi3-manylinux_2_28_x86_64.whl
npm run check
node scripts/install-local.mjs
```

bootstrap 核对合同中的 wheel SHA-256，并将编译用 Python 模块和固定 SimPy 放入被忽略的 `.compiler/`；只调用公开 SDK 的 seal/validate/compile/inspect。独立 Python reference 仅用于测试，生产运行始终在用户浏览器。

也可用 `pi install /absolute/path/to/riffoid-ir-plugin` 安装同一 Pi package。PI WEB 的 Settings → Pi packages 支持本地包源。开发时的安装脚本创建三个可恢复的链接，不覆盖已有文件：

```text
~/.pi-web/plugins/riffoid-ir       → 本仓库
~/.pi/agent/extensions/riffoid-ir   → extensions/riffoid-ir
~/.pi/agent/skills/riffoid-ir       → skills/riffoid-ir
```

刷新 PI WEB 页面，在空闲会话执行 `/reload`，再输入 `/sim show` 并打开 **IR Model** 面板。无需重启已有 session daemon。首次命令或工具调用会启动只监听 `127.0.0.1` 的随机端口桥接服务；面板通过公开工作区文件 API 读取该工作区的连接信息。手动启动时，在插件目录执行 `npm run start -- --workspace /absolute/model-workspace`。它只管理启动时指定的工作区，API 使用工作区 token、同源检查与回环 Host 校验。

## 使用

```text
/sim ir
使用 IR 建立固定 B1 模型，先展示业务模型，暂不运行。
确认规则，继续检查、编译并在浏览器运行，读取本次实际指标和事件。
将第二项任务的 firstWaveTime 从 00:40 改为 00:45，重新检查、编译并运行，比较两次结果。
/sim show
/sim code
```

`/sim code` 只改变后续新模型的默认方式，已有 IR 和结果继续保留。本次明确要求优先。普通 code 任务沿用宿主原有开发工具。

四个工具为 `project_ir_check`、`project_ir_compile`、`project_ir_run`、`project_ir_result`。草稿在 `model/business-ir.draft.json`；修改业务输入必须重新封存和编译。`runOptions` 仅支持 seed。复跑用 `project_ir_run({sourceRunId})`，读取旧模型、Plan、运行时与输入，不使用当前草稿。

PI WEB 页面可直接编辑草稿、检查、编译、运行和选择历史记录。Riffoid 项目页面显示当前模型与历史记录，通过对话修改、检查、编译和发起运行；页面只读取授权数据、执行封存 Plan 并提交结果。启动运行前保持面板打开；没有浏览器连接会返回具体诊断。只有浏览器结果完整保存后，状态才会成为 succeeded。浏览器关闭、执行失败和保存失败均保留可见状态。文件路径与可修改字段见 [建模字段](docs/model-fields.md)。

模型、模型包、浏览器产物及运行时均使用内容寻址快照保存在工作区 `.riffoid-ir/`，每个 runId 有独立记录。`model/` 的固定路径只代表当前模型。本机把工作区连同 `.riffoid-ir/` 一起保留才能重开与复跑；Riffoid 的运行记录与封存执行内容由 Workspace SQLite/R2 持久保存，模型文件仍随 canonical Revision 保存；这些目录默认不进入 Git。服务停止不会自动重试未完成运行，需明确复跑。

## 验证与打包

```sh
npm run check
mkdir -p "$HOME/.local/share/riffoid-ir-plugin/packages"
npm pack --pack-destination "$HOME/.local/share/riffoid-ir-plugin/packages"
```

`npm run check` 包含真实 SDK、独立参考、基准/修改版、诊断恢复、断线、保存失败、快照及适配合同测试。需要先配置编译器。

测试工作区默认在 `~/.local/share/riffoid-ir-plugin/workspaces/pi-web-acceptance`。源码目录只保留程序、固定验收输入和选定证据。先安装并启动 riff-pi，在插件仓库执行：

```sh
npm run start:test
# 在 PI WEB 添加上面的外部工作区，打开其 Browser 面板。
# 另一个终端，仍从插件仓库运行：
npm run test:riff-pi
# 测试成功后，使用输出中的外部结果目录：
npm run acceptance:export -- --from /absolute/external/results-directory
```

该测试通过 riff-pi Direct Bridge 操作真实页面，执行语法错误→修复、基准 B1、延后 5 分钟、重开和原条件复跑，并验证缺少维修活动的故障模型会提供能力诊断且不能误运行；比较独立 Python reference。测试临时使用固定 B1，结束或失败时恢复原有五个模型文件的原始字节，保留所有历史运行。

原始输出及模型备份默认保存在 `~/.local/share/riffoid-ir-plugin/results/riff-pi/<时间>/`。`RIFFOID_IR_TEST_HOME` 可更改外部根目录；`RIFFOID_IR_TEST_WORKSPACE`、`RIFFOID_IR_TEST_OUTPUT` 可分别指定工作区和本轮输出。两者都会拒绝源码仓库及其子目录，包括指向仓库的符号链接。测试独立 PI WEB 实例时，用 `RIFFOID_IR_PI_WEB_ORIGIN` 指定其实际 loopback URL，以读取对应实例的插件 manifest。旧变量 `RIFFOID_IR_EVIDENCE` 作为外部原始输出目录的兼容别名，同样不能指向仓库。

`acceptance:export` 只将成功测试的汇总、运行记录、模型/Plan/运行时/参考结果、诊断、宿主版本与可选截图复制到 `acceptance/results/pi-web/<结果目录名>/`，附逐文件 SHA-256 清单；不覆盖已有证据。连接 token、缓存、模型备份及原始调试日志留在外部目录。

实际验收状态和环境版本见 [验收记录](docs/acceptance.md)。

## 文档

- [复杂系统建模与仿真白皮书（中文精炼版）](复杂系统建模与仿真白皮书_精炼版_中文.md)：多层 IR 架构、人机协作建模、编译与实验追溯，以及领域能力扩展。
- [Riffoid 多层 IR Plugin 使用指南 v0.1](riffoid-ir-plugin-usage-guide-v0.1.md)：工作模式、领域包、模型校验与编译、实验运行、追溯，以及宿主接入与验收。
- [Riffoid IR Plugin 文档评审意见 v0.1](riffoid-ir-plugin-review-v0.1.md)：对上述两份文档的评审意见与核查依据。
- [Riffoid 多层 IR Plugin 功能需求 v0.1](riffoid-ir-plugin-functional-requirements-v0.1.md)：按评审意见整理的 v0.1 功能需求、宿主约束、验收用例与待决事项；与使用指南冲突时以本文为准。
