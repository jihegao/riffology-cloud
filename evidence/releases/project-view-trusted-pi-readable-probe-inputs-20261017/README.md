# Trusted Pi probe-readable：下一批离线输入

本目录是[#242](https://github.com/jihegao/riffology-cloud/issues/242)的可审准备件。新请求`b0933502-20df-480a-9a91-d833f5c4358c`尚未实际传输或运行。[批次合同](../../../docs/project-view-trusted-pi-readable-probe-packet-20261017.md)描述唯一拟执行范围。

- `payload/`：原manifest和严格probe，两份字节未变。压缩包只保留本地，公开身份见[payload-summary.json](payload-summary.json)。
- `operations/`：8项源和固定清单，显式授权校验后才能执行；清单SHA256为`ae0614dafe7067367703ad41a9e0ff19f25de3ab7c788b85f01c1ff5c6b4fffd`。
- [offline-checks.json](offline-checks.json)：15项本地fake检查实际回执及stdout/stderr摘要，无真实外部工具执行。
- [review/result-review-final-ae0614.json](review/result-review-final-ae0614.json)：独立源码、摘要和回执复核，未重复运行测试。
- `history/operations-1d526e/`：被三项must-fix替代的12fake准备回执、清单和先前fixture失败；旧源仍保留在本地，不曾实际传输/启动。
- `independent-readonly/`：独立终态读取源码和本地检查，独立于被测试runner，不发送或读取凭据。
- [inventory.json](inventory.json)：本目录全部审件的字节和SHA256索引（不包含自身）。

上一批a21实际构建成功而入口EACCES，不能记为package或SDK通过；[原实际结果](../project-view-trusted-pi-package-mode-execution-20261017/result.json)完整保留。没有新授权就不执行本包；JHG-46尚未完成。
