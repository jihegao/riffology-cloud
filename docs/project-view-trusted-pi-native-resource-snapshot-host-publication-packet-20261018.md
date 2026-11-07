# #252 host修复镜像：下一发布候选（c263，未执行）

[695e实际离线build/mock与独立清理](https://github.com/jihegao/riffology-cloud/blob/66515084f904f161b581d61829c7f1ff7a2d3719/docs/project-view-trusted-pi-native-resource-snapshot-host-offline-result-20261018.md) 已成功，新Engine/index是 `sha256:0bb9af7a5909c41187cf56402a21420100c72a8de0025b0a7152f8804e85d191`、OCIindex856B、49层；runnable/config尚未导出，不预填身份。原PR253固定head0a10的CI成功仍是源码检查。

新的固定批次使用requestc263a2f3-f445-430e-b562-2e48f1eeb637、新AMD sibling `pi-native-resource-snapshot-host-publication-v1`，现有repo `8b0d70250211aa10d89e20605a1c7e5e/riffology-issue165-trusted-pi`的新tag `jhg46-native-resource-host-20261018-0bb9af7a`。仅一次固定0bb镜像export、所有原rawblob/49diffID验证；原索引链确认后才一次15分钟push/pull凭据、platformpush、tag/digest manifest+config+全部layer实际body回读、临时凭据/原SSH路由清理和独立reader。不重建、不pull/load、不复用旧锁。archive和解压各4GiB上限，未知/失败按原请求停止，无自动retry/fallback。

认证只允许既有同用户同六scope的正常续期，固定auth token命令保持空env输入在参数尾；不发login/consent/新scope。OAuth仅本机，账号级短期Registry凭据仅SSHstdin交付新AMD目录，0600临时config后清除；固定本机7892与远端loopback7897路由归属原PID并有硬期限。凭据文件删除不证明JWT失效/撤销，原OAuth同权限续期可能持久化。

在上述实际完整结果及独立清理通过后，root可按新明确授权在GitHub普通合并PR253，仅head0a10且fresh review/checks无must-fix/漂移；不把GitHub凭据给AMD。此阶段不含应用rollout、Gateway/gate写入、真实provider/Turn/Run/项目或费用订阅变更，不延长旧真实验收截止、不复用旧T2/T3。[候选说明](../evidence/releases/project-view-trusted-pi-native-resource-snapshot-host-publication-preparation-20261018/README.md)与完整source绑定固定具体范围；当前仅准备，不是新授权或实际发布结果。

固定[操作件manifest](../evidence/releases/project-view-trusted-pi-native-resource-snapshot-host-publication-preparation-20261018/operations-manifest.json) SHA256 `6fd9aefcdb09cf0465b3062a0270e4ef3817f74d8829fa99cbfe1f3d031efd8c`，同时绑定8核心文件与reader/test/续期源码合同3项额外源；driver在任何auth/SSH前逐项核对。完整[source binding](../evidence/releases/project-view-trusted-pi-native-resource-snapshot-host-publication-preparation-20261018/candidate-source-binding.json) 为 `08466e9d852deaff0e9b6bf315253d259a29356a9cccb7f645a693a27905b7ae`，绑定16文件。

[最终独立审阅](../evidence/releases/project-view-trusted-pi-native-resource-snapshot-host-publication-preparation-20261018/reviews/independent-publication-preparation-review.json) 无 must-fix；[公开清单](../evidence/releases/project-view-trusted-pi-native-resource-snapshot-host-publication-preparation-20261018/inventory.json) 固定完整公开字节。17项操作fake与11项独立reader fixture是分别运行的本地合成检查；未执行CLI认证、读取OAuth、导出、推送或合并。旧失败/撤回版本与原rawlogs仅本地保留，不提升为本版实际成功。
