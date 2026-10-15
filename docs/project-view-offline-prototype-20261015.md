# 通用页面隔离：已批准的离线原型

2026-10-15 用户选择保留任意 JS，先验证独立浏览器执行边界；不部署、不产生云端费用，10/20 原目标需按证据重新评估。本原型不解除 #214/JHG-46 的生产阻塞。

当前浏览器 iframe 仍能导航外发其读取的项目文本。现有双 loopback 门禁继续保留，并补上 execution worker 对 APP_ORIGIN 的 loopback 检查。导航复现覆盖 href/assign/replace；收到合成 canary 是缺陷证据，不是安全通过。

## 已实现的实验入口

`scripts/m3/project-view-offline-prototype.mjs` 使用本机 Docker Unix socket，必须显式给出本地镜像的完整 sha256，禁止自动 pull。容器无网络、只读 rootfs、非 root、无 capabilities、有内存/CPU/PID 上限；不挂载宿主文件、凭据或 Docker socket，不发布端口。Chromium sandbox 必须启用，启动失败不得用 `--no-sandbox` 代替。

可信 supervisor 经 stdin 输入合成 HTML 与有界点击坐标，容器执行 JS，经 stdout 返回 PNG；宿主只保存经过格式/尺寸/体积检查的 PNG 和实验摘要，不把项目 HTML/JS 注入用户浏览器。实验检查容器无非 loopback 网卡/路由，原生 socket 返回不可达，并比较点击前后的画面。超时、缺镜像、缺浏览器或清理未确认均记录 blocked。

```bash
node scripts/m3/project-view-offline-prototype.mjs \
  --image sha256:REPLACE_WITH_REVIEWED_LOCAL_IMAGE_ID \
  --output .local/offline-view-prototype
```

镜像必须在 `/opt/viewer` 提供 Node、可导入的 Playwright、相应 Chromium 和系统库，用户 10001 能启动启用 sandbox 的浏览器。镜像准备单独审阅；脚本不会安装或拉取镜像，也不修改宿主系统设置。仅本地实验成功时退出 0，证据中 `productionEligible` 仍为 false。

## 当前证据与未覆盖项

本轮验证了启动参数和缺镜像拒绝路径；Mac 未安装 Docker。AMD128 存在 Docker，但只读镜像清单尚未找到满足合同的浏览器镜像，不能宣称原型已运行成功或导航外发已修复。AMD128 的已有 Chromium 直接回归是原 iframe 的独立验证，不是该隔离原型的验证。

此版本是合成画面/点击实验，尚未接入真实 immutable package、MessagePort broker、用户 Web 画面与键盘通道、资源租约、撤权、并发、生产镜像交付。原生 socket 证据只证明测试容器的网络配置，不能证明主机/内核漏洞免疫。生产方案还需真实包的多页/表单/媒体/输入兼容性、退出与释放、带宽/延迟、可访问性、复制粘贴及费用评估，结果形成后再确定排期。
