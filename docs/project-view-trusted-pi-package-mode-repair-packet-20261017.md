# #238 TrustedPi package 权限修复：下一批离线验证包 — 2026-10-17

**后续实际结果：** 本固定包已获直接授权并执行。一次构建生成a946，唯一mock因宿主0600探针入口对UID10002不可读而EACCES，未执行镜像目标或SDK检查；原容器已独立确认清理。详见[实际结果](project-view-trusted-pi-package-mode-result-20261017.md)。下文保留5fe授权前准备快照及原4ae32/bc8e输入，不能据此假称本次验证通过。

负责人 @jihegao；当前选中的 [#214](https://github.com/jihegao/riffology-cloud/issues/214) 验收所需 [#238 最小缺陷修复](https://github.com/jihegao/riffology-cloud/issues/238)。[代码 PR #239](https://github.com/jihegao/riffology-cloud/pull/239) 的候选 commit 为 `0d23a12d869abccb9515a8e7f8196b0266258226`，两份 canonical Dockerfile 的 package COPY 显式增加 `--chmod=0444`，6项相关既有测试及独立 diff 审阅通过。代码尚未合并，本包尚未发送、构建或运行；不代表验收通过。

## 实际缺陷与候选范围

[原实际结果](project-view-trusted-pi-offline-result-20261017.md)保留原57a凭据 POST unknown、一次构建成功、首次 mock 权限断言失败及原CID清理。后续一次只读层检查发现两份原 package 直接条目为 root:root0664；另十个为0444/0555。已执行检查器有间接别名覆盖局限，不能据此证明最终 runtime stat 或原失败的唯一原因。

本候选沿用固定9b76 base、原五份运行源码/六个功能 COPY 目标、原 f27 manifest 和 bded 严格 probe；仅增加原 package.json/lock 的两处 root:root0444 COPY，总计八个目标。没有 npm install、依赖变更、base替换或 supervisor/host/provider 调整。root supervisor→10002 child 的原合同保留，probe不放宽。

## 固定输入

小包 `jhg46-pi-package-mode-repair-v1-20261017.tar.gz` 为 **61,519B**，SHA256 **`4ae32cf711d7500d4b0cd893757ee5a625d9b275518b86e3680146c0b7f7dcd2`**。tar不入库。解压后256,000B，SHA `4e3d89ab85b86d3554d71356e096061d43d645514b633f0aa8af802ff9ba32c3`，恰12个普通成员、238,989内容字节。tar成员**没有 `payload/` 前缀**；[离线清单](../evidence/releases/project-view-trusted-pi-package-mode-repair-20261017/offline-review.json)的本地 members.path 只需去掉该固定前缀，不能套旧c92包顶层目录检查。

固定 FROM：

```text
registry.cloudflare.com/8b0d70250211aa10d89e20605a1c7e5e/riffology-issue165-trusted-pi@sha256:9b76ab9ee7a4f31d250957fbbeefc62d71056e6bd1eb24686ebbeaff3d65873c
```

| 文件 | 字节 | SHA256 |
| --- | ---: | --- |
| [payload/EXECUTION-CONTRACT.md](../evidence/releases/project-view-trusted-pi-package-mode-repair-20261017/payload/EXECUTION-CONTRACT.md) | 4,031 | `96404a60a74eb0d5e1377b7513b046517bd8ade99bfed29c6ff514dfb76e6627` |
| [payload/context/Dockerfile](../evidence/releases/project-view-trusted-pi-package-mode-repair-20261017/payload/context/Dockerfile) | 1,468 | `3ef0b46a9388b9d78a1b82ceeb5c7c2ed821925982975d2a1e2f5a68411a9bb9` |
| [payload/context/services/browser-preview/runtime/sha256.mjs](../evidence/releases/project-view-trusted-pi-package-mode-repair-20261017/payload/context/services/browser-preview/runtime/sha256.mjs) | 2,241 | `85da435e9edaf4dca3411cf5f86fa45a95fe15c78060849d11f7eb0344b5bd24` |
| [payload/context/services/project-resources/text.mjs](../evidence/releases/project-view-trusted-pi-package-mode-repair-20261017/payload/context/services/project-resources/text.mjs) | 6,700 | `9f7f3266549f04a0a8214e6e725ea9d85030532364f136487833e9cc45af303e` |
| [payload/context/services/runtime/controlled-pi.mjs](../evidence/releases/project-view-trusted-pi-package-mode-repair-20261017/payload/context/services/runtime/controlled-pi.mjs) | 23,072 | `cf4143bff6cf049d2ab8247ef86ceb5f5391da67a86acb56ea901a119b2d6871` |
| [payload/context/services/trusted-pi/package-lock.json](../evidence/releases/project-view-trusted-pi-package-mode-repair-20261017/payload/context/services/trusted-pi/package-lock.json) | 150,262 | `ad20b5c766c411c5ba42a4fc997890fe3494ab8adb96cf5d75031366b3d144fc` |
| [payload/context/services/trusted-pi/package.json](../evidence/releases/project-view-trusted-pi-package-mode-repair-20261017/payload/context/services/trusted-pi/package.json) | 244 | `0dde532fe23b810bd09b978f990d48342f7378429f2b2c48f30e055993fa6ebe` |
| [payload/context/services/trusted-pi/release-candidate.mjs](../evidence/releases/project-view-trusted-pi-package-mode-repair-20261017/payload/context/services/trusted-pi/release-candidate.mjs) | 27,185 | `034cdc9df6c09e9cd7a32320e6bbfc2f9bbf5761151fe1d585d7fd64cdcd8d07` |
| [payload/context/services/trusted-pi/research-context.mjs](../evidence/releases/project-view-trusted-pi-package-mode-repair-20261017/payload/context/services/trusted-pi/research-context.mjs) | 1,557 | `938e89155a5d5e0c405f51db5d973a4db264e63d96e308aff8da93caaaa05076` |
| [payload/input-manifest.json](../evidence/releases/project-view-trusted-pi-package-mode-repair-20261017/payload/input-manifest.json) | 6,884 | `f27b35dcbe84b58e3442018332374dbf20fa0d315528a322e56ea2a2bcfea5d4` |
| [payload/probe/compatibility-probe.mjs](../evidence/releases/project-view-trusted-pi-package-mode-repair-20261017/payload/probe/compatibility-probe.mjs) | 12,020 | `bded581766c4656b05b72c6fce39fcb43461a44cbe407c0d1e9ab4a23edf2097` |
| [payload/repair-manifest.json](../evidence/releases/project-view-trusted-pi-package-mode-repair-20261017/payload/repair-manifest.json) | 3,325 | `e668f9080b5a906c1d74b84246aa865cb458c9c1257086b21e920b32d805a84e` |

[独立审阅](../evidence/releases/project-view-trusted-pi-package-mode-repair-20261017/independent-review.json)逐项核对12成员、五源与原probe/manifest字节、两份package冻结字节和八个COPY目标，无must-fix。原功能 manifest 的 overlay6 仍只表示原功能切片；新增两项由 repair-manifest 单独报告，未把总数说成六个。

## 下一批执行边界

新输入和新的 build/mock 尚未获准。上批已明确限定一次 mock，且该次失败已消费；需要对本包及新操作身份给出一次精确授权。新一轮仅拟将固定包和已审操作件发送至 AMD128 原任务目录的新 `pi-package-mode-repair-v1` 子目录，核验现有固定base缓存后做一次断网构建、一次原严格 mock及原CID清理。操作件已经冻结，见下节。

不读取或生成OAuth、Registry或provider凭据，不新增OAuth scope，不建立代理转发，不 pull；既有SSH身份仅用于本次AMD连接，显式禁止agent forwarding。不 push、导出镜像、更新Cloudflare app/policy或启动真实模型/Turn/Run/用户项目。`--network=none`限制构建执行网络；不将其提升为metadata resolver绝无网络请求证明。失败或未知按原身份停止核对，不自动重试、换key或改包。原57a锁、结果、镜像及历史保留。无费用上限、不得新增订阅/自动付款、确凿欠费通知规则继续有效。

## 已冻结操作件与本地验证

[操作清单](../evidence/releases/project-view-trusted-pi-package-mode-repair-20261017/operations/operations-manifest.json)为 **1,372B**，SHA256 **`bc8e45a8783748be4db9fc8040745aa239a2a4473b89740dbc09f290add82383`**，绑定新请求 `a21af2c8-44ff-4f67-a07f-c364bcd6d295`、精确0d23代码和4ae32输入。清单中的七份操作文件逐项bytes/SHA核验通过；不是已执行回执。[完整执行合同](../evidence/releases/project-view-trusted-pi-package-mode-repair-20261017/operations/EXECUTION.md)列出唯一 transfer、原identity核对、一次build/mock、原CID清理和未知停止行为。

本地 **13/13 fake** 实际通过，覆盖授权/包/操作件绑定、12成员及拒绝非法成员、无授权先于SSH停止、无forward/agent转交、部分EOF和lost ACK永久锁、固定builder/镜像角色绑定、原CID NotFound判定及不重启；[检查回执](../evidence/releases/project-view-trusted-pi-package-mode-repair-20261017/operations/offline-checks.json)保留早期macOS测试fixture路径别名失败，再修正fixture通过的事实。没有运行SSH、Docker、认证、provider或真实grant。

未来必须在收到本次直接人类授权后，才生成私有grant，绑定包/操作件摘要、双方目录、原/新请求、代码、执行/排除清单及一小时内有效窗口。缺失、过期或不匹配在SSH/Docker前停止；不自动续期。传输和build各自通过独立目录mkdir固定一次锁，不借原57a身份重试。Receiver在执行公共校验源前硬核其SHA，逐成员手工写入，拒绝多余字节和无关路径。

构建限600秒、每流2MiB完整有界日志；mock内部20秒/外层30秒、每流128KiB。核定实际base和derived descriptor/iid/RootFS前缀及启动Config，再仅对唯一CID create/start各一次；uid/gid10002、network none、readonly、cap-drop ALL、no-new-privileges、默认seccomp、memory768MiB/cpu1/pids128/tmpfs64MiB，只挂原manifest/probe。无来源正文、HOME、credential或workspace挂载。真实成功还须原严格12目标/SDK检查及原CID NotFound和同label空列表；本地fake不替代这些未来证据。
