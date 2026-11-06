# 2026-10-19 IR 宿主发布历史

归档日期：2026-11-06。所属工作：[riffology-cloud #254](https://github.com/jihegao/riffology-cloud/issues/254)。

本目录保存 Registry 镜像回读、Gateway 发布尝试、维护回执和发布停止记录。来源为 [riffoid-ir-plugin PR #3](https://github.com/jihegao/riffoid-ir-plugin/pull/3) 的固定提交 [35de8a1](https://github.com/jihegao/riffoid-ir-plugin/commit/35de8a1c824a547259f4d9dcec2aa29c36c6ccbe)；两份文件逐字节迁入，原有时间、字段、逻辑来源名称和结论保留。

| 文件 | 来源路径 | Git blob SHA-1 |
| --- | --- | --- |
| [结构化记录](deployment-progress-20261019.json) | `acceptance/results/m3-m4/deployment-progress-20261019.json` | `edbf3103a67d7b56b7bf5a2ca5d62729f604c7fe` |
| [文字记录](deployment-progress-20261019.txt) | `acceptance/results/m3-m4/deployment-progress-20261019.txt` | `0fbfa445aad02087d3115d4f104f2813dad2168f` |

这些是 2026-10-19 各次实际观察的历史投影，归档日期不构成新的线上观察。记录中的两次 Gateway PUT、零新成功 ACK、零 app rollout 和未完成 M3/M4，均限于当时覆盖的批次。

后续 2026-10-28 发布、503 修复与维护解除见[发布恢复报告](../../../../docs/project-view-ir-publication-recovery-20261028.md#entry-replay-repair-and-service-restoration)。当前交付阶段与剩余 Riffoid ACC 验收以[发布索引](../../../../docs/release-readiness.md)及 [#254 最新证据](https://github.com/jihegao/riffology-cloud/issues/254)为准。

本批材料属于宿主部署证据。插件保留接入验收摘要与归档引用；Compiler 的 IR 转换、仿真业务语义及 GC 回归证据由 `sim_engine_compiler` 维护。本次只迁入既有选定 JSON/文本，仓库外原始响应、认证材料、截图和构建产物保持原存储位置。
