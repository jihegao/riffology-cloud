# 原 c263：本机完整 Registry 回读与 #253 条件合并结果

2026-10-18 获得本批具体授权后，[4783 固定包](https://github.com/jihegao/riffology-cloud/blob/4783fd50b90181ee1e9a1c8224e63e9c57cf1e37/docs/project-view-trusted-pi-local-registry-readback-packet-20261018.md)已单次执行。原归档完整复验、52/52 项 Registry 正文、原执行唯一 ACK 和独立清理均通过；随后 [#253](https://github.com/jihegao/riffology-cloud/pull/253) 在新鲜 GitHub 门禁下普通合并为 `240378f65fee54d917b053f565087095a07244db`（14:35:00Z／22:35:00 上海时间）。本批完成固定镜像的完整发布证明和源码合并；ec8 镜像尚未 rollout，普通用户验收与 JHG-46 仍未完成。

## 实际执行与身份

沿同一 `c263a2f3-f445-430e-b562-2e48f1eeb637`、新 `registry-local-readback-v1` 一次目录执行，ops `16313c71…`、16 输入绑定 `919648f9…`。先通过单次无转发、无 agent、无复用 SSH，只读核原 push/source 与上一批 14 件停止记录、原 supervisor absence，并完整复验原 407,961,600 B 归档 `deddc210…`：53 个 raw blobs、49 层 diffID 全匹配。没有远端写入、新路由或凭据传 AMD。

随后本机一次正常同用户六项 OAuth token 命令／必要正常续期，两个固定身份 GET，单次 15 分钟账户级仅 pull Registry 凭据 POST（HTTP201）。凭据仅本机内存使用，没有 auth 配置文件。52 个固定 GET 经既有 7892 依次完成，包含 tag/digest manifest、config 和原 49 层位置，重复摘要的位置仍各自保留实际请求。

| 固定对象 | 实际内容身份 |
| --- | --- |
| 原本地 Engine/index | `0bb9af7a…`，856 B；不是本批 Registry runnable 摘要 |
| Registry runnable manifest | `ec8dbe9efe229a1626ea3202b618653f82f8d29d9da8b19310c3b3838f2a2623`，9,585 B |
| Registry config | `cea60e390b6726ec0147153e1318b3655c8386460e98d02e35bb571768e49da5`，19,067 B |
| 52 项完整 HTTP200 正文合计 | 407,919,377 B |
| 本机 GET 首末时间 | 14:29:53.958466Z → 14:32:07.785318Z，133.826852 秒 |

每项完整正文的 size/SHA 均等于 AMD 重验的原 raw blob 描述，manifest 所需 digest header 也匹配。Registry config 正文在本机内存流式哈希后丢弃，AMD 未回传 Config/Env 或归档正文；没有声称直接比较两份 small-raw 内存对象，也未验收 Registry index、attestation、signature 或 Docker pull。

## ACK、清理与合并

原本机 main 于 14:32:07.790231Z 保存成功终态，transport exit0／原 PID reaped，实际唯一 stdout 1,833 B，SHA `c8fb75a1…`。ACK 逐字节绑定 terminal `3f7d78b1…`、完整 52 聚合 `83da7068…`、source proof `d58b14a3…`；final ACK 本身为 `7df2b2b3…`。

冻结独立读取器仅执行一次，14:32:59Z exit0；完整核来源流／对象等值、52 proof→terminal→aggregate、ACK 三 hash，以及原 main、SSH、OAuth Node absence、凭据路径与引用清理。168 条文件引用对应 167 个实际文件（terminal 原字节重复引用一次）。读取器设计上保持 publication/merge=false；root 再与原执行 transport 唯一 ACK 合取，确认完整 Registry 证明。[文件段与组合复核](../evidence/releases/project-view-trusted-pi-local-registry-readback-execution-20261018/reviews/combined-file-review.safe.json)无 must-fix。

新鲜核对固定 head `0a10da572264470aaac111e6f5da2bd20b2f2c45`／base `65df9b7…`、原成功 CI、review/threads、保护与有效规则后，单次正常 `--merge --match-head-commit` exit0；权威回读确认 merge 双 parent 为该 base/head，未用管理员绕过或自动重试。Issue #252/#214 保持 OPEN；交付阶段按实现合并与目标环境验收分开维护。

## 剩余范围与历史

原 [push 停止结果](https://github.com/jihegao/riffology-cloud/blob/41054fedc2089ad520d654a9a1dc35733145676e/docs/project-view-trusted-pi-native-resource-snapshot-host-publication-wire-repair-stop-result-20261018.md)及 [4 尝试／3 证明批次](https://github.com/jihegao/riffology-cloud/blob/fc06f3ae73623006baed9691b88f577039caaa66/docs/project-view-trusted-pi-original-registry-readback-result-20261018.md)的 unknown、锁、原记录和费用历史保留；本批补齐原镜像证明，没有重推、导出、Docker 或重放旧请求。

本批未 rollout 应用、发布 Gateway、改页面门禁或创建项目／模型／Turn／Run。已部署记录仍是 Gateway 9c8／version5a840 与 a036 v12/f18，未由本批重新线上核验。原普通 T1 仍 failed／无 R1，独立 project_write 错误原因与真实用户流程尚未证明修复；旧窗口 12:42:46Z 未延长。下一批需先沿原身份核当前终态／释放，再按新具体范围准备镜像上线和普通用户验收。JHG-46 与另列 JHG-56 不据此 Done／关闭。

清除 Python 引用／本机进程退出不等于安全擦除、服务端凭据撤销或已到期；持续 OAuth 权限保留。费用与全局活动未据本批计数证明，不记零；无费用上限、明确欠费通知及既有 CI 额度豁免沿用，不改付款或订阅。

[结构化实际结果](../evidence/releases/project-view-trusted-pi-local-registry-readback-execution-20261018/result.json) · [原安全证据清单](../evidence/releases/project-view-trusted-pi-local-registry-readback-execution-20261018/inventory.json) · [原 ACK](../evidence/releases/project-view-trusted-pi-local-registry-readback-execution-20261018/original-state/final-ack.json) · [独立 reader 原 stdout](../evidence/releases/project-view-trusted-pi-local-registry-readback-execution-20261018/independent-reader/observation.stdout) · [权威合并回读](../evidence/releases/project-view-trusted-pi-local-registry-readback-execution-20261018/github-merge-readback.json)。
