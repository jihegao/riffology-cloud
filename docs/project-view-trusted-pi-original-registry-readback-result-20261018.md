# 原 c263 Registry 部分回读结果（2026-10-18）

用户批准的 [3fd5a29 固定只回读包](https://github.com/jihegao/riffology-cloud/blob/3fd5a29a1acfb198788b53688ed02130edebfeb5/docs/project-view-trusted-pi-original-registry-readback-packet-20261018.md)已执行一次：**4 次 GET、3 项完整 proof，发布仍 pending，未合并 #253**。固定 ops `59fd2dd0…`、16 输入 `1dc5e1db…` 及新 grant SHA 均在原意图/独立核对中绑定；不是新的 runtime/Turn 授权。

| 槽位 | 原目标 | HTTP | 捕获 / 预期字节 | 结果 |
| --- | --- | --- | --- | --- |
| 0 | 原 tag manifest | 200 | 9,585 / 9,585 | 完整 proof |
| 1 | 同 runnable digest manifest | 200 | 9,585 / 9,585 | 完整 proof |
| 2 | 原 config | 200 | 19,067 / 19,067 | 完整 proof |
| 3 | 第一个 layer | 200 | 11,337,728 / 30,649,033 | 不完整、无 proof |

前三项 raw body 的 size/SHA 与固定归档一致，manifest header 及 small-raw equality 通过；这不证明其余层完整或镜像可完整拉取。slot3 在 read 阶段出现 `ScopeGuard/readback-original-identity-interrupted`；响应已关闭、捕获不完整。该槽耗时 710.843621 秒，同远端时钟首次 GET 至中断 720.000108 秒，对应总 alarm 720 秒。仅可归为总限附近中断，网络/代理/服务/权限原因未证实，不能从此推欠费。

远端 13:25:05Z `unknown-stopped`，本机 13:25:34Z 原 SSH exit1/reaped；完整 52 项记录、唯一成功 ACK 均不存在。没有自动补槽或重试。先前 [wire-repair 发布停止结果](https://github.com/jihegao/riffology-cloud/blob/41054fedc2089ad520d654a9a1dc35733145676e/docs/project-view-trusted-pi-native-resource-snapshot-host-publication-wire-repair-stop-result-20261018.md)中的 push CLI0/digest 匹配和 SSH255 属于旧批，保留原样，不能合并成这次成功。

本批一次同六 scope 正常 token/identity 核对完成；原归档新增一次只读全量复验（407,961,600 B、53 blobs/49 diffIDs）后，一次 15 分钟、账户级 pull-only credential POST201 成功并经 stdin 交付。OAuth 未传 AMD；本机正常 Cloudflare identity/credential API 仍使用其 Authorization header。Registry 凭据不创建 auth/config 文件。本批 export/push/Docker 均为 0；没有部署应用/Gateway、真实 Turn 或原验收窗口扩展。不同主机的 UTC 时间分别记录，不据其计算跨主机先后/时差。

独立 reader/collector 已完成：14 份安全原件共 10,670 B 与原引用逐 bytes/SHA 一致，3 项 proof 绑定 terminal SHA；archive revalidation 和远端 terminal 与原本机两个 safe events 全 JSON 等值。原 supervisor、限定配置路径、7897 路由均确认 absent，本机原 CLI/SSH PID 另证 absent；内存引用清除是原记录。清理不等于服务端凭据撤销/到期或持续 OAuth 权限撤回，也不等于零 VM/零费用。一次额外只读进度观察未用于验收。

[安全证据与边界](../evidence/releases/project-view-trusted-pi-original-registry-readback-execution-20261018/README.md) · [结果 JSON](../evidence/releases/project-view-trusted-pi-original-registry-readback-execution-20261018/result.json) · [完整文件清单](../evidence/releases/project-view-trusted-pi-original-registry-readback-execution-20261018/inventory.json)。原 grant/人类答复、credential、OAuth、raw Config/Env/body/headers/private streams 均不公开；授权/前置快照与实际终态分开记录。

695e 离线通过、原 T1 失败/释放与全部旧 unknown/once 锁/归档/费用历史保持。条件合并尚未满足，普通用户线上验收仍未完成，JHG-46/56 不判 Done；usage/费用 unknown 不记零。

另有4次公开 GET 诊断（3次speedtest及1次固定已发布资产）：本机既有proxy 1 MiB HTTP200/完整2.823732秒；AMD直连 exit6/http0/0 B；本机16 MiB HTTP403/1 B，固定14,029,768 B资产亦HTTP403/捕获0 B、closed=true，无hash匹配或大体积吞吐结论。speedtest body到`/dev/null`、固定资产body不保存/执行，stderr仅length/hash；这些并非Registry带宽/中断根因/欠费证据，没有新增Registry/token/route或重试，主回读4/3保持。[独立附录原件](../evidence/releases/project-view-trusted-pi-original-registry-readback-execution-20261018/public-network-diagnosis/analysis.json)与原主证据分开。
