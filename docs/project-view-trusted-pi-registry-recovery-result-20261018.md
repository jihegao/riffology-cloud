# TrustedPi Registry 9ec 恢复：已授权单次 CLI 失败后停止

2026-10-18，同一 JHG-46 Goal。用户明确授权原 `14d2a2a5` / manifest `3779af35` 冻结包，包括持续 OAuth `containers:write` 与本批一次 Registry 凭据、固定镜像推送、完整回读及清理。实际入口于 09:34:19 Asia/Shanghai 单次启动，原 OAuth CLI PID27665 返回 exit1；本机记录确认回收，独立原 PID 查询确认当前不存在。原五份记录及锁保留，未重试。

固定控制流、原终态及11项后序记录缺席说明本次 driver 未到达 auth-token、元数据/用户/账户身份 API、SSH、AMD路由、Registry凭据POST或镜像发布。CLI原输出仅内存 stdout4345B/stderr354B，未保留内容或hash；CLI本身是否打开浏览器、联网或改变本机OAuth仍未核对，不能声称没有这些副作用，也不证明全账户零活动或零费用。原空stream hash属于未启动的SSH，不能冒充CLI输出hash。

[完整实际结果、精确时间与安全来源](../evidence/releases/project-view-trusted-pi-registry-recovery-result-20261018/README.md) · [结构化结果](../evidence/releases/project-view-trusted-pi-registry-recovery-result-20261018/result.json) · [清单](../evidence/releases/project-view-trusted-pi-registry-recovery-result-20261018/inventory.json)。旧c3e的403原因、原归档/锁/费用及57a/a21/b093历史不变；本批没有重新核验原镜像或完成发布。

随后离线定位到冻结argv的确定参数缺陷：`--env-file`是贪婪数组，前置时吞掉login或auth/token。此诊断不能复原原stderr或证明实际OAuth结果。[#247](https://github.com/jihegao/riffology-cloud/issues/247)仅修正参数位置并补真实纯解析器回归；[新固定修复包](project-view-trusted-pi-registry-argv-repair-packet-20261018.md)是准备，不重放9ec，不沿用旧grant执行新字节。真实下一批须更新固定输入授权。

PR239/246合并、应用rollout、Gateway/门禁及普通受邀skill→双页/保存/刷新/离开/冷恢复仍未由本批授权或验收。JHG-46及完整JHG-56均未完成。

[实际公开结果独审](../evidence/releases/project-view-trusted-pi-registry-recovery-result-review-20261018.json)绑定原件、安全投影及其限制。
