# Riffoid IR Plugin 功能需求与开发合同

**需求版本：v0.2 · 日期：2026-10-18 · 状态：首版开发与验收基线**

本合同将 Opus 与 Fable 评审收敛为一个可交付的最小版本，作为本仓库开发、评审和验收的共同依据。本文中的“必须”及 FR、ACC 编号属于首版承诺；实现示例与后续方向不增加首版范围。

本合同优先决定首版功能范围。原 v0.1 使用指南保留为历史设计参考，白皮书保留为长期方向；其中未被本合同纳入的功能不作为首版验收要求。**本次提交建立开发合同和验收输入，不表示插件实现或双端验收已经完成。**

## 1. 交付目标

用户在**本地 pi-web** 和 **Riffoid 线上 pi-agent** 中，使用同一版本的插件完成：

> 自然语言需求 → 可审阅、可编辑的 Business IR → 检查 → 编译 → 用户浏览器执行 → 保存结果 → Agent 读取并解释 → 修改模型后重跑。

首版交付单位为：**一个共享包、两个宿主接入、一个确定性案例及一次有效修改。**

本合同中的“运行”指浏览器实际执行编译产物；“结果”指该次执行保存的指标与事件；“可恢复”指重新打开项目后仍能读取原模型与结果，并以原产物和输入复跑。

## 2. 首版范围与功能骨架

### 2.1 固定支持组合

| 维度 | 首版约定 |
| --- | --- |
| 宿主 | 本地 pi-web；Riffoid 线上受控 pi-agent |
| 发布单位 | 同一个可安装的 JS/TS 包或同一个包构建产物，包含共享资源、工具逻辑、浏览器模块和两端接入 |
| 领域 | aircraft-support-pack/v0.1；合成 B1 日常保障案例 |
| Business IR | aircraft-business-ir/v1 |
| 执行语义 | legacy-minute-v1；一分钟 tick；本合同案例为确定性输入、seed 0 |
| 编译链 | 复用 sim-engine-compiler 0.1.0 的 seal、validate、compile、inspect 或等价公开 SDK |
| 执行位置 | 用户浏览器；本地或线上服务负责文件、编译和结果保存 |
| 浏览器后端 | 与上述 Plan 匹配的共享 JS 执行模块，覆盖 B1 和本合同规定的合法修改 |
| 业务参数修改 | 写回 Business IR，重新检查和编译，再创建新运行 |

B1 是验证闭环的合成案例，不代表真实业务模型已经验证。首版支持面限于上述组合，不承诺执行领域包的全部语义。现有编译器产品边界、案例来源见 [R1]、[R2]。

### 2.2 包内职责

| 职责 | 最小内容 |
| --- | --- |
| 共享建模资源 | 一份建模 skill；领域概念、已支持规则、Schema 或字段说明、B1 示例、固定版本信息 |
| 编译适配 | 四个工具的共享逻辑；调用现有编译器；整理诊断和产物引用 |
| 浏览器模块 | 模型审阅、运行状态、指标和必要事件；执行编译出的 Plan |
| pi-web 接入 | Pi extension 注册工具；网页与后端通信；工作区文件和结果保存 |
| Riffoid 接入 | fixedSkills、project_* 工具桥、Project Tools、项目页面及结果保存 |

这些是一个包内的职责，不要求分别建仓、独立发布或搭建通用插件框架。LLM 负责理解需求、编辑模型、处理诊断和解释结果；工具内部不需要再启动一轮 LLM。

## 3. 功能需求

### FR-01：同一插件支持两个宿主

两个宿主必须使用同一版本的共享 skill、领域资源、工具语义和浏览器执行模块。宿主适配处理工具注册、文件访问、编译调用、页面通信和结果持久化。

交付必须包含两端安装或接入说明、可重复的构建方式及实际验收的宿主版本。pi-web 的上游插件接口可支持同包 Agent extension 与网页插件；Riffoid 的受控 Pi 提供 fixedSkills 与工具桥装配入口。[R3][R4]

### FR-02：明确进入建模流程

必须支持自然语言要求“使用 IR 建模”，并提供三个便捷命令：

| 命令 | 行为 |
| --- | --- |
| `/sim ir` | 将本项目后续新建模型的默认方式设为 IR |
| `/sim code` | 将本项目后续新建模型的默认方式设为普通代码 |
| `/sim show` | 显示后续建模默认、当前模型类型与位置、可用领域、执行位置和能力是否就绪 |

新项目默认 code。本次明确指令优先；已有模型的类型按实际模型文件判断，修改项目默认不转换已有模型。首版只保留项目默认与本次明确选择两个层次，不引入任务级偏好。

Agent 必须遵守用户指定的推进范围：要求“只生成、暂不运行”时停在模型；已要求完成运行时，正常链路持续推进。缺少影响业务结论的信息时说明假设或询问；常规实现选择由 Agent 处理。

### FR-03：生成可审阅、可修改的 Business IR

Agent 使用宿主现有文件工具，创建或修改 `model/business-ir.draft.json`。用户能在聊天表格或简单页面中看到对象、资源、任务、规则、业务参数、指标和采用的假设，并能定位到对应文件字段或 Business ID。

JSON 文件是模型事实来源。展示内容必须来自当前文件；业务规则与参数修改必须落到该文件。首版提供 B1 所需字段与修改说明即可，无需图形建模编辑器。

### FR-04：真实检查和编译

`project_ir_check` 必须执行 seal → validate，返回可编译的封存模型或结构化诊断；`project_ir_compile` 必须对封存模型执行 compile → inspect，输出模型包和浏览器可使用的产物。inspect 的对象是编译后的模型包。[R1][R5]

编译产物必须来源于本次封存模型，并保留 Business、Plan、模型包和工具链标识。浏览器产物可以是从模型包导出的 Plan JSON 加共享 JS 模块。已有编译器能够给出的校验、版本和关联检查直接复用。

发生模型问题时返回可操作的字段位置或 Business ID、原因和阶段，供 Agent 修改后继续。不得将检查失败的草稿报告为编译成功。

### FR-05：在用户浏览器执行编译产物

`project_ir_run` 为指定产物与实际输入创建 runId，并交给当前宿主的用户浏览器执行。两个宿主运行同一套执行语义。

优先复用兼容的浏览器执行模块；需要补齐时，只实现 B1 及其规定修改所需的 Plan 语义。执行必须读取编译后的参数与操作，不能将固定预期、预存结果或另一份独立编写的仿真当作本次执行结果。

页面至少显示模型摘要、运行状态、关键指标和必要事件。没有连接到可执行页面时返回具体原因；浏览器执行失败或中断必须可见。首版不引入后台作业调度和自动恢复执行。

### FR-06：保存结果，让 Agent 读取同一次运行

浏览器完成计算后，将带 runId 的结构化结果交给宿主保存。保存成功且可读取后，该运行才能报告为 succeeded。

`project_ir_result` 必须让 Agent 读取该 runId 的状态、模型与输入引用、指标及事件或 trace 引用。Agent 的解释必须引用真实 runId、指标和必要事件，并区分观测结果与推断。

两个宿主共用结果字段含义，复用各自文件或 Artifact 存储。Riffoid 当前浏览器桥只有读取与订阅入口，需要补一个具体的运行结果提交与保存动作。[R6]

### FR-07：修改、重新编译和比较

用户改变一个业务参数后，Agent 必须修改 Business IR、再次检查和编译，并创建新的运行。旧运行继续关联原模型、产物和输入。

Agent 能按两个 runId 对比指标和事件，说明实际差异。计数指标相同而事件时间不同也属于有效结果差异。首版直接读两次记录形成表格或文字对照，不要求实验管理或统计分析系统。

`runOptions` 只承载明确支持的执行设置，不能旁路修改模型中的任务时刻、时长、容量或其他业务参数。当前 compiler-v01 的业务参数变更采用重新编译路线。[R5]

### FR-08：重新打开和按原条件复跑

重新打开同一项目后，页面与 Agent 必须能够找到已保存的模型和运行结果。

每次运行绑定当时的模型、编译产物、工具链、浏览器运行时与输入。宿主可用已有版本、内容寻址 Artifact 或运行目录快照保留这些内容；仅保留会被覆盖的“当前文件路径”不满足要求。

复跑指定旧 runId 时，读取其保存的产物与输入，创建新的 runId 并记录 `sourceRunId`。复跑原案例的关键指标与选定事件必须一致；后续修改当前模型不能改变旧运行的绑定。

## 4. 四个工具与最小数据合同

以下名称、字段和含义为两端共同合同。宿主可适配底层传输；读写文件、保存项目和查询历史继续复用宿主能力。

### 4.1 工具接口

| 工具 | 最小输入 | 最小输出 |
| --- | --- | --- |
| `project_ir_check` | `draftRef` | `status: passed \| failed`、`diagnostics[]`；通过时返回 `sealedRef` |
| `project_ir_compile` | `sealedRef` | `status: succeeded \| failed`、`diagnostics[]`；成功时返回 `bundleRef`、`browserArtifactRef`、`toolchain` |
| `project_ir_run` | 新运行：`browserArtifactRef`、可选 `runOptions`；复跑：`sourceRunId` | `accepted`、`diagnostics[]`；已创建运行时返回 `runId` 和实际 `status` |
| `project_ir_result` | `runId` | `runId`、`status`、`diagnostics[]`；已完成保存时返回 `recordRef`、指标及事件或其引用 |

共同约定：

- `draftRef` 是可编辑文件引用；其他产物引用必须能解析到明确保存版本或内容标识。引用可以用宿主已有文件/Artifact 表达，不另建统一存储协议。
- `diagnostics` 每项至少包含 `code`、`stage`、`message`；可定位的模型问题必须包含 `path` 或 `businessId`。
- 首版 `runOptions` 只需支持 `seed`；省略时使用模型中的 seed，保存实际生效值。本合同案例固定为 0。运行期限和业务时间范围按编译模型读取。
- 新运行与按 `sourceRunId` 复跑是两种输入形式。复跑沿用原记录输入与产物；要改变业务条件则走 FR-07。
- 运行状态使用 `pending → running → succeeded / failed / interrupted`。accepted 只表示宿主接受并建立了运行，不表示仿真完成。
- 编译先采用现有短调用；运行可以立即返回 runId，再查询结果。执行或保存的常见失败返回实际原因，不为首版建立通用重试平台。

### 4.2 运行记录

| 字段 | 必须保留的内容 |
| --- | --- |
| `runId`、`sourceRunId?` | 本次运行标识；按旧记录复跑时的来源 |
| `modelRef`、`bundleRef`、`browserArtifactRef` | 封存模型、模型包与实际浏览器产物的可恢复引用和内容身份 |
| `toolchain` | 插件、领域包、编译器、IR/profile、浏览器运行时的实际版本；复用模型包已有标识 |
| `inputs` | 实际生效的执行设置，包括 seed；业务输入由绑定的封存模型给出 |
| `execution` | `location: user-browser`、宿主名与浏览器运行时版本 |
| `status`、`diagnostics` | 实际运行与保存状态；失败原因 |
| `metrics` | 指标名与数值；B1 必需指标见第 6 节 |
| `events` 或 `traceRef` | 有序事件；至少可读取第 6 节要求的 time、phase、kind、entity |
| `stopReason`、`recordRef` | 停止原因，以及宿主保存后的结果引用 |

记录直接声明计算来自用户浏览器，不要求服务端重新计算或新增执行认证体系。首版保证正常使用下的模型—产物—结果对应关系。

### 4.3 文件与保存

沿用现有路径：`model/business-ir.draft.json`、`model/business-ir.json`、`model/model.simpack`、`model/model-spec.json`。前述固定路径可以代表当前版本，历史运行依靠 FR-08 的版本引用或快照。

Riffoid 页面使用 `app/views.json` 和普通 HTML/JS/JSON 资产；pi-web 使用公开网页插件入口。每次运行结果保存为宿主文件或 Artifact，Agent 按 runId 读取。具体目录组织由实现选择。

## 5. 两端接入与必须补齐的工作

| 环节 | 本地 pi-web | Riffoid 线上 pi-agent |
| --- | --- | --- |
| 共享资源与工具 | Pi extension 加载同包资源与四个工具 | fixedSkills 与 project_* 工具桥装配同包逻辑 |
| 模型与编译 | 当前工作区；本地编译进程或已有编译服务 | 项目文件；Project Tools 内现有编译器 |
| 页面和执行 | pi-web 网页插件承载共享浏览器模块 | `app/views.json` 项目页面承载共享浏览器模块 |
| 运行发起 | 将同一 runId、冻结产物和输入交给浏览器 | 通过现有项目页面通信完成相同动作 |
| 结果回传 | 网页/后端接口保存，再供 Agent 读取 | 补具体结果提交动作，保存后经工具桥读取 |
| 重新打开 | 复用工作区与持久化文件 | 复用项目版本、文件或 Artifact |

**首版主要新增工作有两处：兼容 Plan 的浏览器执行模块，以及浏览器结果回到 Agent 的保存链路。**

Riffoid 接入沿用当前用户浏览器 native DOM 的通用项目页面方向；旧 Browser Preview 的固定画布和 marks 合同已退出目标。当前模型包是包含 manifest、Business、Core、Plan、lineage 的 ZIP；页面包支持普通 JS/JSON，尚未包含 .simpack 与 .wasm 类型。因此可在编译侧提取 Plan 为 JSON，由共享 JS 模块读取执行。[R7][R8]

这些是源码基线核对，不代表部署已完成。开发交付需记录实际使用的 pi-web、Riffoid 和编译器版本；如宿主接口变化，由薄接入层适配，不改变本合同的用户流程和验收标准。

## 6. 固定验收案例

### 6.1 输入、版本与预期来源

仓库内提供：

- [B1 封存 Business IR](../acceptance/b1/business-ir.json)：原样保存 Riffoid 当前 compiler-v01 测试输入。复制为草稿后，编辑 payload 并重新 seal。
- [B1 验收预期](../acceptance/b1/expected.json)：基准关键指标、选定事件、一次修改及其预期、来源版本和推导说明。

固定编译器版本为 `sim-engine-compiler==0.1.0`。当前 Riffoid 编译路线记录的 wheel SHA-256 为 `e7bcd9271dd42106b78e87176e3485b290536f5291c0440872b814fc549858f7`；验收记录实际安装制品身份。[R5]

本仓库 Business IR 取自 Riffoid `65df9b771a5d0497304a5955e33974e8ea9aa9ac` 的 B1 fixture；基准预期取自编译器仓库 `5900513b3d3d9c581d50ff904dd460c984afbc96` 中已保存的独立 Python 参考结果。[R2][R9] 文件 SHA、规范化输入 SHA 与 Business fingerprint 是不同身份，不能互相替代。

### 6.2 基准 B1

| 项目 | 固定输入或预期 |
| --- | --- |
| 时间 | 60 分钟；tick 1 分钟；seed 0；无随机采样 |
| 飞机 | F35-01、F35-02，初始均可用 |
| 任务 | 第 20、40 分钟各一次；每次一架飞机、持续 10 分钟 |
| 保障 | 起飞前准备 3 分钟；再次出动准备 0 分钟；飞行后保障 2 分钟 |
| 资源 | flight-line 人员容量 1、设备容量 1 |
| 必需指标 | planned_sorties=2；launched_sorties=2；completed_sorties=2；successful_mission_waves=2；cancelled_sorties=0；delayed_sorties=0；elapsed_minutes=60 |
| 停止原因 | duration |

必须对照以下有序事件，时间单位为分钟，整数值精确匹配：

| time | phase | kind | entity |
| --- | --- | --- | --- |
| 20 | mission_dispatch | mission_launched | sortie-a-d1-w1 |
| 28 | mission_success | mission_success_point_succeeded | sortie-a-d1-w1 |
| 30 | mission_returns | mission_returned | F35-01 |
| 40 | mission_dispatch | mission_launched | sortie-b-d1-w1 |
| 48 | mission_success | mission_success_point_succeeded | sortie-b-d1-w1 |
| 50 | mission_returns | mission_returned | F35-01 |
| 52 | job_progress_and_completions | postflight_completed | F35-01 |

还必须检查一个能区分同刻调度语义的结果：第 30 分钟，F35-01 先返回，再生成并完成零时长 relaunch，准备执行第二次任务。该顺序及其事件断言已列入 expected.json；不能只比总架次。

### 6.3 单字段修改

只将下列 Business IR 字段从 `00:40` 改为 `00:45`，其余业务输入不变：

```text
/payload/sections/mission_profile/collections/composite_tasks/0/definition/taskItems/1/firstWaveTime
```

重新 seal、validate、compile 后，新模型与 Plan 的内容身份必须变化。新运行第一任务事件不变；第二任务起飞为 45、成功点为 53、返回为 55，F35-01 的 postflight 完成为 57。第 6.2 节的计数指标和停止时间不变。

此变更预期是依据固定参考实现规则推导：同日后续任务尚存在时，第 30 分钟返回不会提前触发 postflight；第 35 分钟为第二任务准备；legacy-minute-v1 将 10 分钟任务的 0.75 成功点落实在第 8 个 tick。[R10] **这不是已经执行过的变更结果。** 实现阶段须将其同时与独立参考运行和两端实际浏览器运行核对；若不一致，先查明语义并修订有依据的合同差异，不能按新实现输出反写预期。

## 7. 五项验收与所需证据

全部 ACC 必须分别在本地 pi-web 和实际部署的 Riffoid 上通过。一次测试会话可以覆盖多项，不要求为相同行为建立重复测试体系。

| 编号 | 需求覆盖 | 操作 | 通过条件与最小证据 |
| --- | --- | --- | --- |
| ACC-01 双端完整闭环 | FR-01、02、03、04、05、06 | 安装同版包；检查三个 /sim 命令；用户以自然语言要求按 B1 建模并运行；Agent 写入或基于示例编辑 IR，再调用四个工具 | 两端各保留一条真实会话与工具记录、模型和编译产物引用、浏览器执行记录、保存后的 runId；页面与 Agent 读取同一个 runId 的结果。只生成模型的指令停在模型阶段也须在该会话中核对 |
| ACC-02 确定性结果正确 | FR-04、05、06 | 在两端各编译并运行仓库固定 B1 输入 | 对照 expected.json，必需指标、停止原因及选定事件精确一致；第 30 分钟返回与 relaunch 顺序成立；提交实际结果与比较记录 |
| ACC-03 修改产生有效变化 | FR-03、04、05、06、07 | 用户要求第二任务晚 5 分钟；Agent 修改第 6.3 节字段、重新编译和运行，解释两次结果 | 新 Business/Plan 身份和 runId；原记录保持原值；第二任务事件按规定平移；Agent 指出计数不变、事件时间改变，并引用两次运行；提交变更 diff、独立参考结果和两端结果 |
| ACC-04 重开与原条件复跑 | FR-06、08 | 完成修改后，关闭并重新打开项目，读取基准旧运行，再按该 runId 复跑 | 旧模型与结果可读；新运行记录 sourceRunId，使用基准产物与输入而非当前修改版；关键指标及选定事件与基准一致 |
| ACC-05 诊断后继续完成 | FR-03、04、06 | 在草稿中引入一个 JSON 语法错误，调用 check；Agent 据诊断修复，再继续编译与运行 | 返回文件位置和具体错误，未报告为检查或编译成功；修复后完成真实运行并读回结果；保留诊断和修复 diff |

验收交付附一份简明记录，列出每个 ACC 在两个宿主的通过情况与证据位置，并记录插件包身份、宿主版本、编译器制品、浏览器运行时版本和实际 Agent 模型。证据可以使用宿主已有会话、文件和 Artifact，无需新建证据平台。

**完成定义：四个工具可调用，两个宿主均完成五项验收，B1 和修改版结果满足固定预期，安装/接入及复现步骤可由他人照做。** 文档、截图或预存演示结果不能单独作为完成依据。

## 8. 开发顺序与交付清单

| 顺序 | 交付 | 阶段完成标准 |
| --- | --- | --- |
| M1 | 共享包、建模资源、B1 输入、check/compile | Agent 能生成或编辑 Business IR，并通过现有编译器产出可追溯的模型包与浏览器产物 |
| M2 | pi-web 接入、共享浏览器执行、结果保存 | 本地用户浏览器运行 B1；Agent 读回同次真实结果 |
| M3 | Riffoid 接入同一版本的包 | 线上 pi-agent 经 Project Tools 和项目页面完成相同闭环 |
| M4 | 修改、重开、复跑与验收记录 | 两端 ACC-01 至 ACC-05 全部通过，提交结果及接入说明 |

最终交付包括：可构建安装的插件源码与包；两端必要接入改动及其提交位置；一份简明用户操作/安装说明；固定输入、参考预期与实际验收记录。接入改动可位于宿主仓库，插件仓库记录对应版本。

实现中只因本合同流程无法贯通或验收不能成立而补能力。改变支持语义、固定输入、预期结果或必需功能时，同步修改本合同并说明原因；包内文件拆分、页面样式和普通适配方式由开发者决定。

## 9. 后续范围

首版之外的方向包括：更多领域和 profile、SysML/流程图编辑、WASM 或其他执行后端、批量/蒙特卡洛实验、丰富 trace 和实验管理、包发现安装升级、能力自动扩展、本机或云端高性能执行。

任务管理、多层偏好、订阅市场、私有 Git 分发、通用授权对象、计费账本、服务端强制重算和完整执行证据治理不进入首版清单。

## 10. 依据与源码基线

引用用于说明复用能力和预期来源；首版承诺以本合同为准。

- **[R1]** [编译器 v0.1 产品合同](https://github.com/jihegao/sim_engine_compiler/blob/5900513b3d3d9c581d50ff904dd460c984afbc96/docs/v01-product-contract.md)：公开入口、IR/profile 版本、模型包和示例。
- **[R2]** [B1 canonical 输入](https://github.com/jihegao/sim_engine_compiler/blob/5900513b3d3d9c581d50ff904dd460c984afbc96/tests/fixtures/synthetic/b1-daily-operations.json)；[B1 独立预期](https://github.com/jihegao/sim_engine_compiler/blob/5900513b3d3d9c581d50ff904dd460c984afbc96/tests/fixtures/synthetic/b1-daily-operations-oracle.json)；[参考一致性测试](https://github.com/jihegao/sim_engine_compiler/blob/5900513b3d3d9c581d50ff904dd460c984afbc96/tests/conformance/test_b1_reference.py)。
- **[R3]** [pi-web 插件接口](https://github.com/jmfederico/pi-web/blob/6bdb759ebc90b86d4771d50537d76afbf4a825f7/docs/plugins.md)；[同包 Agent/网页入口示例](https://github.com/jmfederico/pi-web/blob/6bdb759ebc90b86d4771d50537d76afbf4a825f7/examples/session-bridge-plugin/package.json)。这是上游核对版本，不代表用户本机版本。
- **[R4]** [Riffoid controlled-pi](https://github.com/jihegao/riffology-cloud/blob/65df9b771a5d0497304a5955e33974e8ea9aa9ac/services/runtime/controlled-pi.mjs)。
- **[R5]** [Riffoid compiler-v01 authoring](https://github.com/jihegao/riffology-cloud/blob/65df9b771a5d0497304a5955e33974e8ea9aa9ac/docs/compiler-v01-authoring.md)。
- **[R6]** [Riffoid 浏览器 frame API](https://github.com/jihegao/riffology-cloud/blob/65df9b771a5d0497304a5955e33974e8ea9aa9ac/services/project-views/frame-source.mjs)。
- **[R7]** [Riffoid 当前页面方向与历史分界](https://github.com/jihegao/riffology-cloud/blob/65df9b771a5d0497304a5955e33974e8ea9aa9ac/docs/documentation-closeout-20261017.md)。
- **[R8]** [模型包读取](https://github.com/jihegao/riffology-cloud/blob/65df9b771a5d0497304a5955e33974e8ea9aa9ac/services/simulation/compiler-bundle.ts)；[项目页面资产](https://github.com/jihegao/riffology-cloud/blob/65df9b771a5d0497304a5955e33974e8ea9aa9ac/services/project-views/package.ts)。
- **[R9]** [Riffoid B1 Business IR](https://github.com/jihegao/riffology-cloud/blob/65df9b771a5d0497304a5955e33974e8ea9aa9ac/tests/fixtures/compiler-v01/model/business-ir.json)。
- **[R10]** [固定 Python 参考运行时](https://github.com/jihegao/sim_engine_compiler/blob/5900513b3d3d9c581d50ff904dd460c984afbc96/src/sim_engine_compiler/reference/simpy_runtime.py)：同日任务等待、准备、成功点及飞行后保障规则。
