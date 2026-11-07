# Trusted Pi：固定缓存镜像的离线兼容探针通过 — 2026-10-17

本批按用户对[7b8b15f固定包](project-view-trusted-pi-readable-probe-packet-20261017.md)的明确授权执行，新请求`b0933502-20df-480a-9a91-d833f5c4358c`完成唯一一次传输和唯一一次严格mock。包6,195B／5817ecf4…、8项操作清单ae0614da…、原f27 manifest/bded probe和独立bf86 reader均匹配。[完整实际结果](../evidence/releases/project-view-trusted-pi-readable-probe-execution-20261017/result.json) · [安全回执与源码](../evidence/releases/project-view-trusted-pi-readable-probe-execution-20261017/README.md)。

mock于2026-10-17 **22:37:52 Asia/Shanghai**结束通过。原12目标的字节、owner/mode和active-release alias检查、15项SDK场景全部通过；UID/GID10002，model3/research1均为合成，project tool/ambient fetch/真实provider请求为0。只有两份可信宿主输入明确设0444，严格探针及镜像源码均未放宽。本批复用a21已构建的local Engine/descriptor index`sha256:a946b164d10d074fcc9859f6c54c3b65d1901b41696c5ee8d8e31e275ddd1593`，fresh inspect的48层RootFS与launch Config匹配；不是Registry digest、config ID或新构建。

独立回读确认原CID`ed9ac44df539c4bb3e9e046d777c37c650baa0a467e0e13c3b788baffcaab131`为NotFound，正确操作label的全量列表为空。14个原CLI均回收且其原PID/startTicks当前不存在；77个固定记录完成安全核对。独立会话仅两个Docker GET，终态可信；不以本机SSH回收代替远端释放证明。

这完成了[#242](https://github.com/jihegao/riffology-cloud/issues/242)的离线harness修复与复验范围，也为[#238](https://github.com/jihegao/riffology-cloud/issues/238)提供实际固定镜像兼容性证据。[PR #239](https://github.com/jihegao/riffology-cloud/pull/239)仍为两行canonical package COPY0444、尚未合并；本批没有Registry发布、Cloudflare/app/policy更新或真实项目/模型/Turn/Run。原生root supervisor启动合同仅校验保留，未在本次override mock中实际执行。

原[57a离线失败及层检查边界](project-view-trusted-pi-offline-result-20261017.md)、[a21构建成功但入口EACCES](project-view-trusted-pi-package-mode-result-20261017.md)、unknown及原锁全部保留。后续固定镜像导出/Registry推送、PR #239合并以及原应用镜像rollout仍需各自明确批准和实际证明；default应用rollout可能替换/启动实例，不能当作无运行副作用的配置PATCH。普通受邀skill→页面/保存/刷新/冷恢复及完整JHG-56仍待验收，#214/JHG-46未完成，不宣称持续可用或全局零费用。
