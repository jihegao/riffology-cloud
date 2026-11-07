# 原 c263：本机完整 Registry 回读固定包（未执行）

[上一批实际结果](https://github.com/jihegao/riffology-cloud/blob/fc06f3ae73623006baed9691b88f577039caaa66/docs/project-view-trusted-pi-original-registry-readback-result-20261018.md)仍是 4 GET 尝试、3/52 项完整证明。首层虽 HTTP200，仅收到 11,337,728/30,649,033 B，在总限附近中断；独立清理通过，完整发布和 #253 条件合并尚未通过。该批授权已实际使用，所有 unknown、原记录、锁、归档、tag 和费用历史保留。本页准备下一次具体授权，不重放已用批次。

新包保持同一 c263 请求、原 407,961,600 B 归档、0bb9 原 index、ec8d runnable manifest、cea60 config、49 层和 52 个固定槽位。改为由本机读取 Registry 正文：短期凭据留在 Mac 内存，AMD 仅做源归档只读复验，不接收凭据、不新增转发或文件。固定输入见[操作清单](../evidence/releases/project-view-trusted-pi-local-registry-readback-preparation-20261018/operations-manifest.json)和[16 件完整绑定](../evidence/releases/project-view-trusted-pi-local-registry-readback-preparation-20261018/complete-source-binding.json)：

| 固定对象 | SHA256 |
| --- | --- |
| 12 项操作输入清单，2,062 B | `16313c7193782acce5cd88de7c0e2caf97c76e59c807b581b8b58ef54642eafa` |
| 16 件完整绑定，2,717 B | `919648f9e77ea0a77033e9aaa1fd3aefda24510ae5dd7a55ba19ba2723571572` |
| 主执行程序 | `2565c433a9c2d5364a3a77aad3aa8ef14254a234f7a74d6df6c930f0d2d4ce8c` |
| 独立读取器 | `d73b1624476eb3c7fa929bff3fd6d3d99fc4a062fa9a7229c8d09aac15be6be5` |

## 本批执行范围

1. 在新的本机 `registry-local-readback-v1/operations/local-readback-once` 保留一次执行锁。单次无转发、无 agent、无复用 SSH 向已有 AMD128 发送固定只读代码；不写远端目录。先核上一批 14 件停止记录、原 supervisor 身份与 absence，再核原 push/source 记录，完整复验原归档的 53 blobs 和 49 diffIDs。缺件、漂移、原进程仍在或结果未知均停止，认证不得提前。
2. 复验可信后，仅在本机一次读取既有同用户六项 OAuth；必要时由已固定 Wrangler 正常续期，不新 login/consent、不加 scope。两个固定 identity GET 确认 Personal 账号 `8b0d70250211aa10d89e20605a1c7e5e` 及原用户摘要。随后单次申请 15 分钟、账户级 **仅 pull** Registry 凭据；它不能限制到单个仓库，程序限制为原仓库和固定摘要。OAuth 与 Registry 凭据均不传 AMD，Registry 凭据不落配置或日志。
3. 本机通过既有 `127.0.0.1:7892` 做恰 52 个计划槽位的 GET：tag manifest、ec8d digest manifest、config 和原 49 层位置；每项至多一次，不跟 redirect、不自动重试。GET 总时限取 720 秒与本批 grant 剩余时间较短者，逐槽保存安全 intent/terminal/proof；末项及 ACK 前再次核授权期限。首个失败或未知即停止，其余槽位不继续。
4. 清除凭据引用后保存终态。只有全部 52 个完整实际正文的固定 size/SHA、独立读取器对来源流/记录/原 PID 清理的核验，以及原执行唯一 ACK 都可信，root 才能按新鲜保护、review 和 CI 门禁普通合并 [#253](https://github.com/jihegao/riffology-cloud/pull/253) 的固定 head `0a10da572264470aaac111e6f5da2bd20b2f2c45`。程序和读取器不自动合并。

内容身份合同为：AMD 完整重验原归档 raw blobs 的 SHA/size 和 diffID 链，本机对实际 Registry 完整正文核同一固定 SHA/size。AMD 不回传 raw Config/Env 或归档正文；Registry config 响应会在本机内存流式读取并哈希，不持久化。没有声称直接比较两份 small-raw 内存对象。清除 Python 引用不等于物理擦除、服务端撤销或到期，持续 OAuth 权限仍保留。

## 检查与未覆盖范围

最终程序/测试的[作者完整套件](../evidence/releases/project-view-trusted-pi-local-registry-readback-preparation-20261018/author-validation/final-formatted-complete15.receipt.json)单次 15/15 通过；[读取器作者检查](../evidence/releases/project-view-trusted-pi-local-registry-readback-preparation-20261018/reader-offline-checks.safe.json)另有 15 项新 fixture 通过。原首轮引用错误、13 项中间快照及 5 项定向检查分别保留，后两者不能相加为 18 个唯一用例。先前[文档纠正](../evidence/releases/project-view-trusted-pi-local-registry-readback-preparation-20261018/documentation-correction.safe.json)只限定 raw Config 来源措辞；随后[格式纠正](../evidence/releases/project-view-trusted-pi-local-registry-readback-preparation-20261018/formatting-correction.safe.json)仅移除一处空行中的空格，AST 完全等价，并对当前最终程序字节重新完成一次 15/15。旧已执行包的检查没有重跑。[逻辑独审](../evidence/releases/project-view-trusted-pi-local-registry-readback-preparation-20261018/reviews/source-review-before-format.json)与[最终格式复核](../evidence/releases/project-view-trusted-pi-local-registry-readback-preparation-20261018/reviews/final-source-review.json)已完成，`mustFix=[]`；root 另核全部 16 输入、原记录绑定和 52 槽位。

这些均为本地合成检查。本候选没有实际认证、源 SSH、Registry 凭据生成或 GET，也没有新 grant。移除反向转发不证明中断根因或新路径速度：52 项正文共 407,919,377 B，720 秒内至少需约 566,555 B/s，尚未计算协议开销。公开小文件成功和大文件 403 都不能替代 Registry 带宽或欠费证据。

本批不 build/pull/load、export、tag/push、启动容器、rollout、改应用/Gateway/门禁，或执行真实项目/模型/Turn/Run；不延长原已到期验收窗口，不改付款、订阅或自动付款。无费用上限、明确欠费通知和既有 CI 额度豁免沿用。完整发布、后续上线及普通用户验收分开记录，JHG-46 未完成。

详细[执行合同](../evidence/releases/project-view-trusted-pi-local-registry-readback-preparation-20261018/EXECUTION.md)、[授权字段](../evidence/releases/project-view-trusted-pi-local-registry-readback-preparation-20261018/AUTHORIZATION.md)和[证据清单](../evidence/releases/project-view-trusted-pi-local-registry-readback-preparation-20261018/inventory.json)供本次具体审批。
