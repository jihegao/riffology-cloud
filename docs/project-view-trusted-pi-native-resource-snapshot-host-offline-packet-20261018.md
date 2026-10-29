# #252 baked host 资源快照修复：下一次离线输入

当前仅准备，未执行。原普通受邀T1已失败并停止后续阶段；本批只验证修复后的本地镜像兼容性，不承接原剩余两次Turn或任何应用发布权限。

[PR253](https://github.com/jihegao/riffology-cloud/pull/253) 固定 head `0a10da572264470aaac111e6f5da2bd20b2f2c45` 的CI已成功。新host只复用现有validator接收合法resources来源；原五字段兼容与严格scope拒绝均有回归。新离线包唯一覆盖host root:root0555，其余11个源文件保持f18既有字节。详细输入与边界见 [候选说明](../evidence/releases/project-view-trusted-pi-native-resource-snapshot-host-offline-20261018/README.md)。

唯一新请求 `695e8875-459a-41b3-a148-2e228f2c3727`，目标AMD128既有任务父目录下的新 sibling `pi-native-resource-snapshot-host-v1`。包 `jhg46-pi-native-resource-snapshot-host-v1-20261018.tar.gz` 为12,364 B / SHA256 `91b42a14a3c1c8caafb0b98230f156408bc39be065d408091055e91f7c724b81`，5个无前缀普通成员；[archive receipt](../evidence/releases/project-view-trusted-pi-native-resource-snapshot-host-offline-20261018/archive-receipt.json) 完整列出字节和hash。操作件manifest固定为 `fe1ab539e48c1a19d1b48e355b63c93a7c8c1c82bdcee319a385c7aac1ef78c5`（10份source），input manifest为 `7106ff37f714ec60135962a9f71e661d911ba5e0e4870178175a8b1bf5260d22`；两者须与此包和新授权同时匹配，不复用旧一次锁。

候选允许的将来动作：用现有SSH身份一次transfer/unpack；本地tag严格预检a946/f18/config07c/48层后，一次断网build；一次UID10002、只读、无网络的mock；原CID清理和独立两GET回证。仅精确probe/manifest以0444挂入，env仅PATH。不读OAuth/Registry/provider凭据，不开代理，不pull/push/export、安装包、部署、改门禁或运行真实Turn。缺缓存、漂移、不支持、任何未知均停在原身份，不自动重试/新项目/新key/provider fallback。

唯一source-equivalence mock在2026-10-18 18:42:28 Asia/Shanghai通过：真实host+controlled facade配合3次内存fake model/research，各种快照与拒绝分支通过；projectTool/globalfetch0。该macOS检查不验证image UID/mode/caps，也不是AMD、Cloudflare或用户验收。[安全检查投影](../evidence/releases/project-view-trusted-pi-native-resource-snapshot-host-offline-20261018/checks/offline-checks.safe.json)。[23项pure检查](../evidence/releases/project-view-trusted-pi-native-resource-snapshot-host-offline-20261018/checks/operations-checks.safe.json) 是17项操作fake与6项独立reader fixture；总体独审单列，不混作实际容器结果。

原费用/unknown/失败历史保留；本候选不证明project_write已修或页面已保存/恢复，JHG-46仍未完成。未来基础tag缺失或表示合同不符时不修tag或静默放宽验证。未来真实验收需单独固定recipe与授权；本包不包含mkdir后的真实付费执行。

本次仅offline，不延长旧真实验收截止2026-10-18T12:42:46Z（Asia/Shanghai20:42:46），不授权新Turn，不取用原剩余T2/T3。后续新镜像Registry/rollout和新普通验收均不在本次范围。

[最终独立审阅](../evidence/releases/project-view-trusted-pi-native-resource-snapshot-host-offline-20261018/reviews/independent-final-preparation-review.json) 无 must-fix；[公开文件清单](../evidence/releases/project-view-trusted-pi-native-resource-snapshot-host-offline-20261018/inventory.json) 固定本版公开字节。审阅没有重新运行测试或远端操作。
