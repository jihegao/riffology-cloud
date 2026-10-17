# #238 package 权限候选：第二批实际结果 — 2026-10-17

本批一次构建完成，但唯一 mock 在打开探针入口时失败；原容器已独立确认清理。[完整结果](result.json)保留证据、边界及剩余验收。

已收到的直接人类授权绑定5fe9367b、61,519B／4ae32输入、bc8e操作件和新请求a21af2c8，代码候选0d23a12。一次传输已ACK；[独立安装回读](sources/transfer-installed-independent-readback.json)确认12个payload和7个操作件。授权安全收据的invoked:false是执行前快照，不是当前零执行声明。没有复制原grant或人类答复。

[唯一执行收据](sources/build-launch-safe-receipt.json)及[独立原记录回读](sources/independent-build-cleanup-readback-v4.json)确认一次构建得到 `sha256:a946b164d10d074fcc9859f6c54c3b65d1901b41696c5ee8d8e31e275ddd1593`，固定base的RootFS前缀及User、Entrypoint、Cmd、WorkingDir、Env保留。metadata descriptor、iid与Engine ID均绑定这一local descriptor/index身份；configDigest未提供。未push或export，不能称Registry digest或config ID。

唯一mock start返回1，stderr为924B／0b018b22…、Node22.23.2／EACCES。[固定stderr白名单定位](sources/fixed-stderr-path-independent-readback.json)确认syscall `open`、精确路径 `/compat-input/probe/compatibility-probe.mjs`；其余13个已知路径不匹配。Node无法打开入口，因此本批没有执行严格12目标或SDK检查，没有probe-report，不能判断a946的package权限修复通过或失败。旧57a的ownership断言不是本次错误解释。

安装回读中的probe和manifest均为host uid/gid1000、0600；冻结runner在start前核验mock为10002:10002和两份readonly bind。该权限差异支持外部harness输入不可读缺陷；直接证据是入口open EACCES。本批没有新容器内stat或成功探针，不能借此推断镜像内package文件状态。原probe字节、manifest和断言未放宽。

独立回读确认原CID `65714c5c5e5377ca8f761c8a1a85d6baa5bd18bc994f95c0ae07db24c4d7ec19` 为NotFound、正确操作label的all容器列表为空；15个原CLI均记录reaped且原进程已不存在。start非零后wait和completed-inspect没有运行。独立回读的两个Docker只读进程均已回收。Local SSH回收与remote清理分别报告，不能互相替代。

三次只读helper先后因record-mode guard停止：首轮 [7a65／c76](sources/independent-build-readback-first-failed.json)、第二轮 [e468／9746](sources/independent-build-readback-second-failed.json)、第三轮 [99e37／b4db](sources/independent-build-readback-third-failed.json)。三次均未到Docker GET。第四轮实际helper为 [e100](sources/build-mock-cleanup-read-v4.py)，仅让三份固定CLI identity文件接纳实际0664；父0700、owner、regular/nonlink、大小和精确身份校验保留，未修改远端文件。未执行的0fbb版本不列为实际证据。

原57a credential POST unknown、首b2c2候选ownership断言失败、原清理及层检查局限保持在[原实际结果](../../../evidence/releases/project-view-trusted-pi-offline-execution-20261017/result.json)和[原结果文档](../../../docs/project-view-trusted-pi-offline-result-20261017.md)，摘要仍72f567cd…，没有覆盖历史。本批没有新的凭据操作、pull/push、镜像导出、Cloudflare app/policy更新或真实模型/Turn/Run；不据此记费用零。

下一步是最小harness输入可读性修复及新的精确有界验证授权。本批的单次mock已经消费；后续启动a946须另有精确授权。当前结果不代表普通受邀用户验收、线上持续可用或JHG-46完成。

本记录只收录核对过的安全收据和确实执行的helper源码；摘要见result.json及[inventory](inventory.json)。没有原grant/人类答复、private streams、Env/config值、私有actor正文或凭据。所有时间使用明确标注的收据时区，不倒填未知时刻。

后续最小修复范围由 [#242](https://github.com/jihegao/riffology-cloud/issues/242) 承接：准备两份原探针输入的明确只读权限，并复用已有a946镜像验证；新容器尚未获准，本记录不授予执行。
