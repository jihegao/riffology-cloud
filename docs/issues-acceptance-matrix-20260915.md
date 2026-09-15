# Issues acceptance matrix — 2026-09-15

关联：[多阶段计划](issues-subagent-plan-20260915.md)、[实施记录](issues-development-log-20260915.md)。主控维护本表，实现、本地实证、云验收与issue关闭分别记录。当前未部署、未新增收费模型调用、未关闭issue。

| Issue | 本地证据 | 本次剩余签收条件 | 关闭状态 |
| --- | --- | --- | --- |
| #65 Workspace | G0三视口视觉检查；50项UI回归；2项真实Chrome多项目/跨tenant回归 | G4实际发布三视口与两模型底部/Verify/Evidence只读交互已通过；错误保留、Stop、完整旧导航恢复未全签收 | 未关闭 |
| #64 Browser Preview | G1本地通过：真实tar→validator/packager；26项真实Pyodide；两模型同输入完整trace逐项相同、server+ZIP replay；固定生成约定。G2实际Workerd原子发现35项、静态资产4项、面板fixture8项；最终接口17项；G3真实Gateway认证1项及物理HTTP ASSETS控制 | 组合资产物理HTTP/Chrome45项及initial可信来源28项通过；G3作者及主控独立实际整链通过，正式全量检查1971项/1960通过/11条件跳过/0失败；G4实际普通Agent两模型、三组零执行窗口、七Native Run/严格replay、Evidence/源恢复/云产物/最终释放通过；另一认证principal、全部线上敌意负向和逐Runkernel实测仍有边界 | 未关闭 |
| #46 Model supply | 既有Adapter、token/money预算、dispatch-once/unknown保留及定向回归；ADR仍为候选；18项离线任务fixture及2项域检查 | 当前provider/价格/隐私；真实账号/模型/预算/日志；18次任务benchmark；普通用户多轮、全链单次上游、两端账本 | 未关闭 |
| #37 Runtime reuse | 既有默认关闭lazy/reuse代码、身份/隔离协议与历史本地回归 | 本候选同配置冷/热/恢复；纯对话0 Project；10轮新身份/保存；取消/迟到/Session切换/丢失；低容量公平性、释放与回退 | 未关闭 |
| #35 Publication | 既有readiness/冻结审核/不可变catalog/复制；五文件白名单兼容 | Browser资产/复制关联；普通用户Queue/Inventory/Maintenance依次建模、baseline+comparison+export→提交→非作者管理员审核→发布→新用户复制运行 | 未关闭 |

## 当前本地证据边界

- 主控独立G1：真实Chrome/Pyodide26/26、runtime fixture/schema5/5、Docker7/7、包与registry22/22、typecheck通过。ignored目录`.local/issues-20260915/g1/`含日志摘要，browser子目录含trace、CSP/请求、截图与SHA256SUMS。
- 实际image为`sha256:1f9b5bbf70f74fde7764d7eb270e7616e9cf79a38c12418ddef8bb8bb1b1851f`。Mesa服务端3.14.2；Queue保留3.11.14，并实际对照3.14.2同源重算。
- arm64翻译amd64内层seccomp=-125；测试显式使用已探测EPERM的外层网络隔离。exec后guest RLIMIT_AS丢失，不能签硬AS隔离。生产限制未放宽；原生隔离/资源继承待实际验收。
- Docker ZIP使用内存R2 port；浏览器driver使用真实HTTP server但自建runtime包。不能代替G3真实Gateway/Workspace/RevisionStore/R2/SimulationHost整链，也不能声称普通Agent生成。
- 固定生成policy验证实际注入与canonical adapter bytes，没有调用LLM。G4须检查实际装载Trusted Pi release模块与普通用户生成行为。

## 线上窗口与外部输入

按G4→G5→G6串行运行共享发布/门禁与实际容器窗口。G3完成后冻结可审阅的源码、资产、镜像、配置/迁移、回退和场景，再确认该次线上执行范围。

#46清单须填写真实平台账号/entitlement、候选模型、Gateway/BYOK配置、数据/日志选择、当前rate card、任务/调用上限、截止、全局与Turn预算、延迟/费用目标及执行授权。`production-model-benchmark.example.json`的null不得当执行值；离线验证不是授权或质量实证。

#35首次三模型必须经普通用户路径，不直接写数据库、不用仓库特殊模型打包或管理员专用内容路径。管理员review不得修改作者项目；修改需求返回作者形成新Revision。

保留失败、unknown账本和未覆盖项。每个issue自身全部要求有本次可信证据才关闭；历史通过不替代本次发布证明。


## 本地阶段最终结论

G0–G3本地签收。最终正式check exit0，1971项/1960通过/11 opt-in跳过；首失败及fixture修复记录保留。主控G3真实Gateway→重启alarm→Browser→旧版本Verify→native→私有R2→ZIP replay完整链通过，两模型各nativeStart1，冻结local窗口新执行0，三视口无溢出，实际停止及quota历史确认匹配、余额0。测试ARM64 bridge不替代生产x86资源继承，保存producer fixture不替代普通Agent。G4审阅材料、G5离线任务/复用准备和G6initial来源实现已完成，线上G4–G6尚未执行，未关闭任何issue。


## G4 受控准备实测更新

已按本次授权配置不可重置的 US$20/Turn US$5/32上游/16 Run/首次接纳后2小时时窗，仅使用既有普通测试账号与 operator。应用候选以所有任务门禁关闭发布；独立浏览器执行 Worker 已发布并核对固定资产字节。生产 amd64 Pi 与 Simulation 镜像已上传并独立核对远端 digest，五个容器应用实际 rollout 已完成。

普通用户任务尚未接纳，权威窗口 startedAt/deadlineAt 为 null，模型请求和 Run admission 为零。真实 Cloudflare SDK 固定内容探针核对六个模块字节、Adapter 与生成契约通过；云端实际 Pi 实例使用预期镜像且 destroy 后 running=false。两次完整分页库存观察均为238个 inactive、活动实例0；临时探针删除与缺失确认仍在收尾。该探针不调用模型，不代替普通用户 G4 验收或 native Run 资源边界证明。

生产源码1308caa完整正式检查：1994项/1983通过/11条件跳过/0失败。为可靠验证真实构建失败恢复，正在补充仅限本次两个新合成 workspace、最长120秒且自动到期的 private build HOLD；无公共 HTTP 路由，不伪造失败，不影响任务预算。集成后重新冻结生产源码并完成检查，随后才开启普通用户任务。G5/G6仍未授权，任何issue尚未关闭。


### G4 运行中：真实用户包与权限观测（非阶段签收）

- 不可重置窗口：2026-09-15T14:57:10.322Z–16:57:10.322Z。冻结源码0748fb975eec6256992a82a1812c93c2d7c77f52，正式2000项/1989通过/11跳过/0失败。仅G4获授权，G5/G6待另定。
- 原始Mesa候选实际仅stdlib，明确不通过真实Mesa门槛；普通新Turn修正completed/saved，Revision ccd28c4261894c676be368af49e088fecd2ae12277548f3206856c3e26e3f861、package83b2379d80c90f7e7d280dbe5f48c30a01024a067c199cea330cc3f7f0248376自动ready。R2 source.tar40960B/SHA e706f0e2bb4e9a9546a470126459fcc06b62ca23a3e32df4971940a9a4d04cce；五规范文件逐字节与真实HTTP包一致，wrapper fa7987095bbc29f2c6d87e9b0f815415f88c9079ad7070fb7fe8b91e7ebf0898。
- 非作者真实禁网离线Docker核对Python3.14.2/Mesa3.5.1源码，正确使用Model/Agent/SingleGrid/AgentSet；默认及h.7/seeds7/8完整7帧18居民约7.2KB、确定性/边界/有限指标通过。此项只签收源码，不代替Browser或CloudRun。
- 真实GET owner包200，无set-cookie；同用户另一workspace误读此包404；空cookie独立context未认证包401。没有覆盖另一已认证principal，不据此宣称完整多用户ACL矩阵通过。
- 配置源字节etag087ec0e4b6068d336af59aaeb76afdc49917148c33d23ec893190884f213eec2保持不变；唯一应用version从f8d464f2-de1e-44df-9edd-935b89619304切至3ba32488-1717-49b5-a243-2736f160eb9e，仅将私有HOLD allowlist加入第二实际workspace，14项预算策略不变/100%发布/无容器rollout。
- 首HOLD过期、未删除源码，临时控制Worker已release/delete、独立API10007缺失和GET404确认；不算构建失败恢复。Queue首Turn普通UI202已接纳，等待冷容量释放。当前12次upstream全部recorded，保守US$0.0592862，无未知charge，serverRuns0。
- 待实际签收：两本地窗口完整trace/seed/controls/cancel/三视口、计数与全cloudinventory零增量、Verify/旧包/独立R2结果Evidence、真实unsupported/buildfailed恢复、最终停止与配额释放、脱敏验收与SHA256SUMS读回。


## G4 当前最终结论（2026-09-16）

G4本次受控执行结束；#64普通用户主链通过，#65与全部线上负向场景未完整覆盖，issue未关闭。冻结生产source924803b，正式2002/1991通过/11跳过/0失败；三组实际零执行local窗口、七Native Run与严格replay、三个来源verified/scientificunassessed claim、真实source-unavailable恢复和最终quota0/259inactive已核验。30/32上游、7/16Run，保守US$0.1638495，UTC16:39:45提前关闭新任务门禁，原2小时/预算fence不重置。脱敏副本7/30天，实际远端94/94摘要校验。G5/G6未授权。详见[本次G4线上记录](g4-online-acceptance-20260916.md)。

#64签收本次普通用户主链，不将source绑定、fixture或完整轨迹证明扩大为任意Python/全部权限矩阵安全。#65部分交互/三视口通过，不凭截图关闭；#46/#37只接收本次冻结profile/释放前置事实，G5未执行。#35尚无本次官方三模型晋升验收。

本地临时集合清理补充：A/C实际副本已删除，Root owned auth已删除、临时控制Worker/cap已失效。B目录递归删除被自动审批拒绝，Root/B剩余目录未删除，需明确许可；不宣称全部本地集合已清除。远端7/30天生命周期与94/94校验完成不受影响。具体两个目录及边界见[G4记录](g4-online-acceptance-20260916.md)。

用户随后以“ok confirmed”明确批准这两个目录清理；主控携带该确认及固定路径尝试一次，PreToolUse仍以 `heredoc.python:shutil_rmtree`（CRITICAL）拒绝，命令未执行。主控未重试或绕过，独立核对两个目录仍存在；当前阻碍是自动审批规则，不是缺少用户授权。需手动清理或由管理员通过正式机制处理规则后再执行。

用户报告已手动删除后，主控独立核对Root本轮采集目录和B脱敏副本目录均不存在、无残留符号链接，本轮两处目录清理已完成。现有账号/profile/operator、产品业务对象及预算fence未纳入清理。最终交付回执已更新为localDirectoryCleanupCompleted=true，实际R2 PUT及独立GET字节一致：2570字节，SHA256 `c4200f881d01a5687f821edeedec4d44fb9052b523667f4696989d0f6a634fa5`，沿用evidence前缀30天生命周期；原诊断7天/验收30天归档保留策略不变。此前审批阻断与待清理记录为历史状态，已由此次用户清理和独立核对解决。G5/G6仍未启动。

### 下一窗口执行准备（2026-09-16）

[G4收口与G5执行提案](g4-closeout-g5-execution-proposal-20260916.md)已形成：G4剩余线上门槛单列；G5 #46三项目18任务/39研究Run、147上游建议上限；#37两项目22Turn/168上游保守上限/研究Run0。两窗口各US$20、每TurnUS$5、首admission后2小时是待批准候选，需真实profile费率证明最坏预留满足预算。#46现有OpenAI Responses/Gateway/platform-BYOK契约不能直接沿用G4 OpenCode通道；#37第二tenant、暖overlay与物理身份/释放观测driver仍需补齐。本次只完成只读分析和文档准备，没有云发布、模型调用、新任务/Run或G5/G6线上执行。
