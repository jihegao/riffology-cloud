# 获批后的关闭入口候选

用户2026-10-08 12:33:01 UTC（Sentinel_d74bc92248288191a1631d8044d57811）批准固定生产包a0ab4881；此批准本身不证明活跃Google client关联事实；用户随后2026-10-08 12:39:44UTC（Sentinel_7e50dcd00afc8191bcba47be71cc6966）明确确认提供的公开Client ID就是旧站使用的client，不再索要此事实。此次只构建无私钥的候选并读回GitHub main，不进行任何线上写入。入口完整单文件为`entry.worker.mjs`（ES module，16,198 bytes），SHA-256：

```text
856eb92c777ee04a569dfe53f5bec44d90566341e9c2d3632bf7f4c75de9a0eb
```

`entry.disabled.json`是新账号指定Worker的关闭bootstrap配置，包含精确日期/flags及公开vars，故意不含route、私钥、native-IP边界ACK或任何应用资源。不能把它当切流配置：后续获准的控制台步骤仍须分别设置domain/WAF、用户直接注入Secret并回传公开ring、旧账号pin/replay及完整配置、Google关联与callback、联动canonical/CSP和真实验收。

**父任务下一次仅引导第一步**：请用户在已登录新账号`3232ebc7e9bb0199b92e3d70b07825af`打开[Workers & Pages](https://dash.cloudflare.com/3232ebc7e9bb0199b92e3d70b07825af/workers-and-pages)，点Create application，先停在创建方式选择页，仅回报该页提供哪些创建选项（不回报秘密）。待确认有现有权限可用的代码创建/编辑通道，再分步用本完整bundle创建`riffoid-entry`；本步不要求登录、token、Git连接/安装或额外grant，不绑定域名/改DNS/填写私钥/改付费计划。官方[Dashboard文档](https://developers.cloudflare.com/workers/get-started/dashboard/)确认Workers & Pages→Create application入口，但当前官方页以Git创建为主，不据此假定用户页面一定有Hello World/Upload/Quick Edit。不允许自动连Git授予权限以绕过通道缺口。

**原账号准确阻塞**：新鲜metadata GET在sandbox和已批准网络执行均失败：existing Wrangler auth token expired，非交互refresh失败。未登录/创建token/扩权限，未取得本轮当前版本或完整settings。因此历史Gateway93/Execution4绑定与版本只是前次快照，不能覆盖现在线上配置。恢复既有授权通道并重新核对当前完整metadata/settings/namespace history及code/assets/version是原账号发布前置；不因生产批准跳过这个防覆盖步骤。当前原站由本任务零写保持。

`manifest.json`固定四个代码候选hash及28个Gateway/forward rollback相同exports。其余三个大包在工作区`.local/riffoid-approved-20261008/`；入口与bootstrap小包附于此处。replay namespace/public pin/migration history/完整生产配置/assets仍null，状态是CODE_FROZEN_CONFIGURATION_PENDING_NOT_READY_TO_CUTOVER；不是冻结生产回退包。代码语法和hash核对通过，本轮没有runtime/模型/工具/Turn/Run或付费验收；文件gzip大小仅构建指标，不代表计量成本/额度验证。未升级/订阅计划。

Google callback已在批准范围，client关联现已由用户确认（不是独立Google API读回）；当前代理没有可用的Google Cloud OAuth client管理通道，原Wrangler授权也已过期。本轮没有修改callback。后续用户在既有Google控制台仅追加`https://app.riffoid.com/api/auth/callback/google`、保留原三redirect及其他全部设置；不要新login/token/grant或读取Secret来补通道。
