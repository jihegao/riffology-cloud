# 新host镜像发布候选：c263（未执行）

固定来源是[695e实际离线结果](https://github.com/jihegao/riffology-cloud/blob/66515084f904f161b581d61829c7f1ff7a2d3719/docs/project-view-trusted-pi-native-resource-snapshot-host-offline-result-20261018.md)：一次build/mock及独立清理已完成，Engine/index `0bb9af7a5909c41187cf56402a21420100c72a8de0025b0a7152f8804e85d191` /856B，49层；原实际image probe是UID/GID10002、Node22.23.2、12target/14check。该结果不是原T1 project_write修复、真实provider或用户验收。

本候选新request `c263a2f3-f445-430e-b562-2e48f1eeb637`、新目录 `pi-native-resource-snapshot-host-publication-v1`、同现有repo新tag `jhg46-native-resource-host-20261018-0bb9af7a`。所有旧archive/请求/锁/费用历史保留。本批先新单次export，再全rawblob/49diffID验证；runnable/config和archive字节/hash当前是未观测，必须由固定已知index完整链推导。无第二save、build、pull、load、容器start或格式转换。[scope](scope.json) · [操作说明](EXECUTION.md) · [新授权字段](AUTHORIZATION.md)。

仅复用既有同用户、同六scope的正常token续期；当前没有读取OAuth/调用CLI。未来只固定auth token命令可正常刷新，不能login/consent或扩大scope，失败/缺失/漂移即停。依据[当前固定CLI源合同](renewal-source-contract.json)与[官方auth token文档](https://developers.cloudflare.com/workers/wrangler/commands/general/#auth-token)；固定源码hash约束执行版本，文档不替代当前二进制结果。15分钟Registry push/pull凭据是账号级，不声称repo级，OAuth不出机，JWT仅SSHstdin并在临时0600config终态清除。

[操作件manifest](operations-manifest.json)固定8核心文件以及reader/test/续期源码合同3项额外源；任一漂移均在auth/SSH前拒绝，原grant的manifestSHA同时绑定这11项。[候选完整源码绑定](candidate-source-binding.json)另绑定reader、fixtures与来源。[17项操作fake+11项reader fixture](offline-checks.safe.json)分别真实在本机运行，均无auth/SSH/Docker/API。reader只对原记录/小raw元数据作核对，归档仅stat，不能称独立重读全blob；完整归档与diffID读取由固定publisher完成。所有新导出、推送、临时凭据和路由的实际终态仍待新的明确授权与实际证据。

完整导出/推送/全body回读和独立临时资源清理通过后，root才可按另列合同进行PR253固定head `0a10da572264470aaac111e6f5da2bd20b2f2c45`的普通GitHub合并及权威读回；必须fresh checks/review、无新must-fix、无head漂移。AMD不取得GitHub凭据，driver没有merge。此准备不授权执行，不rollout/改Gateway或门禁、不新Turn/Run/模型/项目，不延长或挪用旧真实验收窗口。JHG-46仍未完成，JHG-56完整范围后置。
