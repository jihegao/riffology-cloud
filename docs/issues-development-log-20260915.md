# 多阶段实施与验收记录

日期：2026-09-15。基线：`40aee17`。当前阶段：G0 开发中。

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
| G0 | 实施中 | 契约一致、非作者评审、#65 本地三视口 |
| G1 | 未开始 | 确定性包、隔离 runtime、server Mesa |
| G2 | 未开始 | saved 派生构建、持久 API、Workspace、Agent 约定 |
| G3 | 未开始 | 非作者评审、真实本地整链、完整 check |
| G4 | 未开始 | 冻结发布、普通用户两模型、零执行窗口、资源释放 |
| G5 | 未开始 | #46/#37 账号/预算、账本、故障/复用验收 |
| G6 | 未开始 | 三模型普通用户→审核→发布→新用户复制 |

线上状态未改变；签收时追加提交、命令、证据与明确缺口。

## 主控复核与环境记录

- 基线完整检查首轮因新工作树缺少 `.local/` 父目录导致历史测试 mkdtemp ENOENT；补齐 ignored 目录后重跑，日志 `/tmp/riffology-issues-baseline-check-20260915.log`。
- 已核对 `simulation_process.py` seed 与 Model Spec 参数名称/值类型，发现包与 runtime 初稿存在大小限制差异，已要求双方统一。
- 共享 alarm 当前合并 Workspace/Turn/Service/Observer/Simulation 五类唤醒。阶段 2 新增 build wake 必须覆盖所有调用点，防止任务结束误删构建 alarm。
- RevisionStore 现有 `serviceFiles` 可读取文件而不恢复 Pi Session；历史 resolver 必须基于可信保存索引与项目权限，不接受客户端对象路径。
- 已查阅当前 [R2 Workers API](https://developers.cloudflare.com/r2/api/workers/workers-api-reference/)、[Pyodide Worker](https://pyodide.org/en/stable/usage/webworker.html)及 [Worker CSP](https://developer.mozilla.org/en-US/docs/Web/API/Web_Workers_API/Using_web_workers)。条件写入失败返回 null 与写入应答丢失须分别处理；Worker 需在自身响应执行隔离策略。
