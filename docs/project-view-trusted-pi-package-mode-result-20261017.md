# #238 package 权限候选：实际构建与探针入口失败 — 2026-10-17

用户已批准固定5fe9367包后，原请求 `a21af2c8-44ff-4f67-a07f-c364bcd6d295` 完成一次传输、一次缓存断网构建及一次 mock 尝试。原包61,519B／`4ae32cf7…`、操作清单 `bc8e45a8…` 和代码候选 `0d23a12d…` 均匹配；原锁、历史和输入保留。[完整实际结果](../evidence/releases/project-view-trusted-pi-package-mode-execution-20261017/result.json) · [逐阶段说明和安全回执](../evidence/releases/project-view-trusted-pi-package-mode-execution-20261017/README.md)。

一次构建得到 local Engine/descriptor index `sha256:a946b164d10d074fcc9859f6c54c3b65d1901b41696c5ee8d8e31e275ddd1593`，保留原base RootFS前缀及启动Config。该身份未推送、未导出，不能当作Registry digest或config ID。

唯一mock返回1。固定924B stderr的摘要和已知路径投影确认 Node22.23.2 `EACCES / open /compat-input/probe/compatibility-probe.mjs`。宿主probe/manifest输入为uid1000、0600，而mock为10002:10002，两份输入以readonly bind挂载。Node未打开probe入口，因此12目标及SDK场景未执行，a946内package权限修复效果仍未评估。原探针、manifest和断言未放宽，未重跑容器。

原CID `65714c5c5e5377ca8f761c8a1a85d6baa5bd18bc994f95c0ae07db24c4d7ec19` 已由独立原ID NotFound及正确操作label空列表确认清理；15个原CLI均已回收且原进程不存在。三次独立记录读取因过严的文件mode guard先行停止、均未执行Docker GET；纠正后的第四次读取才执行两个只读查询。失败、实际helper源码和完整摘要全部保留，不把本机SSH回收当作远端清理证明。

[#242](https://github.com/jihegao/riffology-cloud/issues/242) 仅承接harness输入可读性修复：复用已有a946，保留原f27 manifest与bded probe字节，为两份可信宿主输入明确只读权限，准备下一次有界探针验证。[PR #239](https://github.com/jihegao/riffology-cloud/pull/239) 的两行Dockerfile范围保持不变；#238完整mock完成条件仍未满足，#214/JHG-46尚未完成。

本批未发布镜像、更新Cloudflare app/policy或启动真实模型/Turn/Run。原57a凭据POST unknown、首b2c2失败及历史层检查局限保持在[原结果](project-view-trusted-pi-offline-result-20261017.md)。下一轮容器验证需新的精确授权；不据此声明普通用户验收、持续可用或费用为零。
