# Issues acceptance matrix — 2026-09-15

关联：[多阶段计划](issues-subagent-plan-20260915.md)、[实施记录](issues-development-log-20260915.md)。主控维护本表，实现、本地实证、云验收与issue关闭分别记录。当前未部署、未新增收费模型调用、未关闭issue。

| Issue | 本地证据 | 本次剩余签收条件 | 关闭状态 |
| --- | --- | --- | --- |
| #65 Workspace | G0三视口视觉检查；50项UI回归；2项真实Chrome多项目/跨tenant回归 | G4实际发布三视口、真实preparing→ready、错误保留、导航/保存/Preview/Stop | 未关闭 |
| #64 Browser Preview | G1本地通过：真实tar→validator/packager；26项真实Pyodide；两模型同输入完整trace逐项相同、server+ZIP replay；固定生成约定。G2实际Workerd原子发现35项、静态资产4项、面板fixture7项；最终接口17项；G3真实Gateway认证1项及物理HTTP ASSETS控制 | G2 combined资产交付与实际整链签收；G3本地整链；G4普通Agent两模型、原生隔离/资源、零执行local窗口、Evidence与云产物/资源 | 未关闭 |
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
