# 通用页面隔离：已批准的离线原型

2026-10-15 用户选择保留任意 JS，先验证独立浏览器执行边界；不部署、不产生云端费用，10/20 原目标需按证据重新评估。本原型不解除 #214/JHG-46 的生产阻塞。

当前浏览器 iframe 仍能导航外发其读取的项目文本。现有双 loopback 门禁继续保留，并补上 execution worker 对 APP_ORIGIN 的 loopback 检查。导航复现覆盖 href/assign/replace；收到合成 canary 是缺陷证据，不是安全通过。

## 已实现的实验入口

`scripts/m3/project-view-offline-prototype.mjs` 使用本机 Docker Unix socket，必须显式给出本地镜像的完整 sha256，禁止自动 pull。容器无网络、只读 rootfs、非 root、无 capabilities、有内存/CPU/PID 上限；不挂载宿主文件、凭据或 Docker socket，不发布端口。Chromium sandbox 必须启用，启动失败不得用 `--no-sandbox` 代替。

可信 supervisor 经 stdin 输入合成 HTML 与有界点击坐标，容器执行 JS，经 stdout 返回有界的 PNG 候选字节。当前只检查 PNG signature、IHDR 长度/类型、800×600 尺寸和体积，**不校验完整 chunk/CRC、不解码像素**；证据明确记录 `frameValidation: png-header-only`、`userUiEligible: false`，这些本地实验文件不得进入用户 UI。脚本不把项目 HTML/JS 注入用户浏览器。实验检查容器无非 loopback 网卡/路由，原生 socket 返回不可达，并比较点击前后的字节摘要；这不替代像素语义或导航外发验收。超时、缺镜像、缺浏览器或清理未确认均记录 blocked。

```bash
node scripts/m3/project-view-offline-prototype.mjs \
  --image sha256:REPLACE_WITH_REVIEWED_LOCAL_IMAGE_ID \
  --output .local/offline-view-prototype
```

镜像必须在 `/opt/viewer` 提供 Node、可导入的 Playwright、相应 Chromium 和系统库。镜像和本机容器安全策略必须联合验证：非 root Chromium sandbox 通常需要允许 user namespace 相关 clone/setns/unshare；普通 Docker 默认 seccomp 仍可能阻断。本启动器不放宽 seccomp，不加 SYS_ADMIN/privileged、不退回 no-sandbox，无法启动时保持 fail-closed。启动参数请求启用 sandbox 不等于已经独立验收其实际边界。镜像/策略准备单独审阅；脚本不会安装或拉取镜像，也不修改宿主系统设置。仅本地合成实验及清理均成功时退出 0，证据中 `productionEligible` 仍为 false。参考 [Playwright Docker](https://playwright.dev/docs/docker)、[Docker none 网络只保留 loopback](https://docs.docker.com/engine/network/drivers/none/)。

## 中断与原任务清理

每次运行在输出目录先用排他创建写入 pending `evidence.json`，包含 operationId、唯一 containerName、镜像身份与 `runAttempted`；容器带同一 operation label。CLI 以异步子进程运行，SIGINT/SIGTERM 取消当前 CLI 并等待独立清理；终止 CLI 本身不被当作容器停止。清理先查原 operation 的容器，核对原 name、镜像、label 和不可变 ID，删除前持久化已核对 ID，只按该 ID 删除，再确认原 operation 缺席。清理失败保持 blocked；重复运行不得覆盖原目录的 intent/证据。

SIGKILL、断电或宿主崩溃不保证自动执行 finally。保留原 pending 证据后可显式恢复清理，不启动新实验、不按名称前缀批量删除：

```bash
node scripts/m3/project-view-offline-prototype.mjs --cleanup \
  --operation ORIGINAL_OPERATION_UUID \
  --output .local/offline-view-prototype
```

operation 必须与原文件一致，containerName 必须由该 UUID 唯一派生；身份不符不会删除。尚无已验证容器 ID 的 pending create，即使列表暂为空也保持 `original-create-unresolved`，不能用空列表推断迟到创建已被栅栏阻止。若原容器已可验证，则按原 ID 清理；若创建仍未知，保留原任务记录继续核对，不另发 run。恢复清理成功仅证明原任务资源缺席，状态仍 blocked，不升级为浏览器隔离或实验通过。

## 当前证据与未覆盖项

本轮本地 `node --test tests/m3/project-view-offline-prototype.test.mjs` 通过 11 项（退出 0）：启动参数、缺镜像拒绝、注入的有效结果/超时/SIGTERM/清理失败及恢复、错误 operation/容器身份、pending create 空列表与损坏输出。runner、Docker 结果、信号和画面均为显式合成 fixture，**没有执行 Docker 或 Chromium**；这些测试只验证控制与输出处理代码。Mac 未安装 Docker。AMD128 存在 Docker，但尚未准备同时满足镜像和本机安全策略合同的浏览器运行环境，不能宣称原型已运行成功或导航外发已修复。AMD128 的已有 Chromium 直接回归是原 iframe 的独立验证，不是该隔离原型的验证。

此版本是合成画面/点击实验，尚未接入真实 immutable package、MessagePort broker、用户 Web 画面与键盘通道、资源租约、撤权、并发、生产镜像交付。原生 socket 证据只证明测试容器的网络配置，不能证明主机/内核漏洞免疫。生产方案还需真实包的多页/表单/媒体/输入兼容性、退出与释放、带宽/延迟、可访问性、复制粘贴及费用评估，结果形成后再确定排期。
