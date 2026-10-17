# 仿真 Browser Preview 退役盘点 — 2026-10-15

> **历史审计快照（2026-10-15）**：以下“当前”、未实现、Project 权限及候选状态仅描述原审计基线，不是现态。当前产品决定、证据迁移与 JHG-48 文档验收见 [2026-10-17 收口](documentation-closeout-20261017.md)。原扫描/JSON 保持历史字节；不据此重新授权执行、删除或延长容量。

**保留** [#214](https://github.com/jihegao/riffology-cloud/issues/214) / [JHG-46](https://linear.app/jhgao/issue/JHG-46) 的通用 HTML/JS 项目页面、路由与只读订阅。**撤销**仿真 Browser Preview 及全部相关旧案例；旧 js-frame/frame 模板、render(context) + marks DSL、固定600×420画布、五/七文件合同不保留为可选 profile。通用宿主是当前交付目标，并非已经上线的替代实现。

按用户 [PR217范围评论](https://github.com/jihegao/riffology-cloud/pull/217#issuecomment-6188262716)，本次仅更新审计PR说明/文档与清单，不自动改写或关闭其他Issue/PR，不开始删除实现或案例文件。固定34生产项目的内容purge仍未实施。

## 扫描范围与完整命中

扫描严格使用 `git archive fbc0e46bde2c8781b71609fa4524d2e75bffaf99` 的全部跟踪文件，不读取原用户脏工作区、不下载资产、不运行产品。新增审计文档单独标记，不计入基线。基线共3006个跟踪文件，其中2943个可读UTF-8文本。

逐文件路径、命中行号、正则、相关引用、分组及生产耦合见 [机器可查清单](evidence/releases/browser-preview-retirement-inventory-20261015.json)。

| 模式 | 命中文件数 | 非docs文件数 |
|---|---:|---:|
| marks 单词 | 33 | 10 |
| js-frame | 15 | 9 |
| 600 与 420 尺寸组合 | 27 | 23 |
| riffology.browser-js | 11 | 11 |
| browser-scene | 8 | 8 |
| javascript-canvas | 19 | 17 |
| 五/七文件源合同 | 30 | 20 |
| Python Browser Preview 合同 | 101 | 79 |
| 相关 Browser Preview 引用 | 214 | 150 |

前六项并集去重为75个文件，其中非docs为40个。分组重叠，不能相加。机械命中不等于可删除：`marks`也命中无关英文断言及旧source map，尺寸组合也可能是非合同文本；五/七文件和Python声明同时存在云端计算用途，必须核对调用。

## 旧路径与案例清单

| 组 | 基线文件数 | 待清理职责 |
|---|---:|---|
| services/browser-preview/ | 80（普通50、retained30） | 合同、验证器、build/discovery/orchestrator、旧宿主/worker/renderer、profiles/不可变索引及兼容bytes。整条仿真路径退役，不保留当前stdlib/Mesa为兼容profile。 |
| NetLogo Fire独立示例与专用脚本/测试 | 9 | 旧案例源、许可说明、Spec/可视化/lock、浏览器本地运行器和专项测试一并清理。 |
| spikes/mesa-browser-runtime/ | 11 | Queue/Schelling演示、worker/页面、协议、浏览器/Python验证与旧验收文档。 |
| runtime/fixtures/ | 5 | Queue/Mesa/Traffic/Fire旧模型删除；run.py先迁出云端Run共享职责。该组包含于80，不另加。 |
| tests/m3/browser-preview-* | 19 | 旧合同/生成/构建/Canvas/legacy/浏览器专项与helpers；通用隔离/授权行为按新宿主重建覆盖。 |
| G4 build专项 / local-runs专项 / legacy fixtures | 3 / 2 / 3 | 删除随旧仿真路径存在的测试；先区分共享alarm、R2恢复和原执行安全行为。 |
| services/web专用旧模块 | 3 | browser-preview.js、local-runs.js、verify-handoff.js；混合app/comparison/simulation入口先解耦。 |
| ui/原型 / native G5 fixtures | 10 / 5 | 仅列引用审查对象，不按目录名全删；通用页面原型、独立native费用/执行身份不能被旧Preview清理吞掉。 |

案例精确路径如下；其他组的逐文件路径保存在JSON对应groups字段。

### NetLogo Fire

- `examples/netlogo-fire-candidate/README.md`
- `examples/netlogo-fire-candidate/app/requirements.lock`
- `examples/netlogo-fire-candidate/docs/SOURCE_AND_LICENSE.md`
- `examples/netlogo-fire-candidate/model/model-spec.json`
- `examples/netlogo-fire-candidate/model/model.py`
- `examples/netlogo-fire-candidate/model/run.py`
- `examples/netlogo-fire-candidate/model/visualization.json`
- `scripts/model/netlogo-fire-browser-local.mjs`
- `tests/m3/netlogo-fire-candidate.test.mjs`

### Mesa浏览器spike

- `spikes/mesa-browser-runtime/README.md`
- `spikes/mesa-browser-runtime/VALIDATION.md`
- `spikes/mesa-browser-runtime/browser-acceptance.mjs`
- `spikes/mesa-browser-runtime/browser.test.mjs`
- `spikes/mesa-browser-runtime/index.html`
- `spikes/mesa-browser-runtime/models/queue_trace.py`
- `spikes/mesa-browser-runtime/models/schelling.py`
- `spikes/mesa-browser-runtime/protocol.js`
- `spikes/mesa-browser-runtime/protocol.test.mjs`
- `spikes/mesa-browser-runtime/test_models.py`
- `spikes/mesa-browser-runtime/worker.js`

### Browser runtime fixtures

- `services/browser-preview/runtime/fixtures/fire.py`
- `services/browser-preview/runtime/fixtures/mesa.py`
- `services/browser-preview/runtime/fixtures/queue.py`
- `services/browser-preview/runtime/fixtures/run.py`
- `services/browser-preview/runtime/fixtures/traffic.py`

### 额外旧fixture审查项

- `tests/fixtures/preview-legacy-run.py`
- `tests/m3/fixtures/browser-models/mesa.py`
- `tests/m3/fixtures/browser-models/queue.py`

## 删除前必须迁出的共用职责

| 引用链 | 精确入口 | 处理 |
|---|---|---|
| Turn/Workspace保存与alarm | services/turn/store.ts:175、services/workspace/store.ts:24、services/workspace/durable.ts:23–37/239/279–385/1722，shared-alarm.ts、turn-alarm.ts、alarm-router.ts | 保存事务直接触发Preview discovery，主DO导入build/orchestrator/registry。先移除专用发现、RPC与wake slot；保留原子Revision、其他alarm调度、原Run终态/释放。 |
| Gateway资产与页面入口 | gateway/index.ts、gateway/app.ts、browser-preview-services.ts；infra/wrangler.phase1-staging.jsonc:31；scripts/m3/materialize-browser-preview-web.mjs:21–28 | 当前ASSETS指向.local/browser-preview/gateway-assets，生成器同时复制通用services/web。先迁出通用网页构建/根目录及独立origin交付，再删仿真路由、素材与配置。 |
| canonical native adapter | runtime/fixtures/run.py、turn-runtime/managed-runner.ts:1、tests/m2/managed-runner.test.ts:7、scripts/model/benchmark-task-fixtures.mjs:14、scripts/issue77/live.mjs:34 | adapter字节同时服务云端Run；迁到独立canonical源（已有services/run/model_run_adapter.py须先核对同一性）并更新生成/测试引用。不能删掉云Runs语义与原费用/未知执行保障。 |
| 默认prompt与Managed候选 | trusted-pi/release-candidate.mjs、turn-runtime/managed-candidate.ts、managed-testing-instructions.ts | 去掉仿真优先指导、五/七文件及固定renderer要求；独立保留answer/design/文件保存和原执行收据，不删除整个Managed runtime。 |
| 混合Web面板 | web/app.js、index.html、simulation.js、comparison.js、workspace.css | 去掉旧Preview实例/参数播放和本地simulation，保留通用layout、文件/产物、路由、身份会话和独立服务端Run。 |
| 测试与发布脚本 | package.json:8/23、.github/workflows/check.yml:39–40，materialize与Wrangler配置 | 删除旧文件时同步去掉glob/显式命令；保留新宿主授权、撤权、scope/generation、消息限额、摘要与恢复验证。 |

以上入口及行号来自固定基线，完整productionCouplings字段可供后续实施逐项回查。独立执行origin、sandbox allow-scripts且不授予主站同源、MessagePort绑定、ACL和不可变摘要是通用页面仍需满足的行为，不能随旧模板一起删掉保障。

## 文档、证据及任务后续

基线35个docs文件命中前六项关键词，包括旧Browser Preview合同/生成文档、发布静态证据和历史打包source map。完整路径已列在patterns与并集中。旧教程/案例内容和源码快照属于清理审查对象；保留日期、部署身份、无内容执行/费用/释放事实，不把全部历史档案作为当前兼容实现继续发布。`AGENTS.md`、README及更广泛Browser Preview产品说明也在相关引用扫描中；后续需消除旧产品承诺，本PR不改项目约定文件。

[#150/#127、JHG-14/JHG-45等任务及PR208](pi-extensibility-conflicts-20261015.md#browser-preview-撤销后的待调整项)仍有待调整口径。本次仅列清单，未执行这些改动。#196/#202历史完成与固定34实际内容删除分开，不伪称Fire已撤回或生产数据已清空。

实施时先移出共享职责、断开旧生产调用，再删除案例/专用实现/资产/测试并更新脚本，最后以新通用页合同验证保存、路由、隔离与刷新恢复。固定34内容按原fence/释放/共享引用及防复活流程另行purge；不恢复旧ID或重放旧请求做验收，不让全量退役成为通用页主线的自动前置。

本次只做清单/文档验证与diff检查，没有启动Browser/Pyodide、模型、Wrangler部署、云端Run或数据清理。实际代码清理时应按受影响组件运行check:ui、typecheck及有意义的保存/授权/adapter测试；不通过删除安全断言来获得green。
