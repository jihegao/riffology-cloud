# b093：一次严格离线探针通过与独立清理确认

2026-10-17，用户对[固定7b8b15f包](../../../docs/project-view-trusted-pi-readable-probe-packet-20261017.md)的明确授权已执行。新请求`b0933502-20df-480a-9a91-d833f5c4358c`完成一次固定输入/操作件传输、一次network-none缓存镜像mock、原CID清理及独立只读回读。[完整安全结果](result.json) · [用户可读结果](../../../docs/project-view-trusted-pi-readable-probe-result-20261017.md)。

镜像是既有a21构建的local Engine/descriptor index`a946b164…`，856B，linux/amd64；本次fresh inspect与原48层RootFS、完整launch Config匹配。它未被导出或推送，不能冒充Registry digest、config ID或线上部署。

严格原probe和manifest字节均未变。接收端仅两份公开输入为0444，其余操作/授权/脚本日志仍私有；Docker CID元数据例外与原冻结合同一致。mock以UID/GID10002执行：12目标字节、owner/mode/active-alias及15项SDK检查通过；模型3次、research1次均为合成，project tool/ambient fetch/真实provider请求均为0。原start stdout中的实际probe报告为2,978B／SHA256`56b918764ae85ab11ba4891bd828753ed34f45f9faa0ca955ee3b3c53dd66e4f`；runner保存的格式化probe-report.json为3608B／SHA256`aa3b4738192328a3c9498b300a337b47fc8afc77a7286243e8755a6ef6561b12`，两种编码按同一JSON值核验。独立reader逐字段校验该实际报告后仅返回冻结安全投影；15个原名见result.json，不能把投影当作未经校验的任意报告。

原CID`ed9ac44df539c4bb3e9e046d777c37c650baa0a467e0e13c3b788baffcaab131`在独立新SSH下确认为exact NotFound且正确label全量列表为空。14个原CLI的PID/startTicks、终态与当前原进程不存在均已确认；77个固定记录被核型、权限、有界字节与摘要。该reader只发两个Docker GET，二者均回收；本机三次SSH均exit0且回收，local reaping本身不充当远端清理证明。

- `sources/authorization-receipt.json`：绑定实际人类答复的私有canonical projection摘要；时间为本机观察/记录，不伪称原始提交时间。原grant和reply正文不公开。
- `sources/operations/{transfer-once,mock-launch-once}/`：实际一次发送/启动的安全intent、SSH身份、ACK和终态；原始private streams不公开。
- `sources/independent-readback-once/`：独立只读回读的实际ACK、intent和SSH终态，完整安全回执30,964B／`e77565f4…`。
- `sources/run-independent-readback-once.py`：实际2517B本地transport，SHA256`1623358ad7e6e0c8e778f5146da21c2a6aea278f9c670c5f3272bcc389bb3feb`。只通过stdin内存运行固定bf86 reader，不入8项远端操作清单。
- `review/`：独立实际结果审阅回执。
- [inventory.json](inventory.json)：公开审件的逐文件bytes/SHA索引，不含自身。

原57a unknown凭据POST、首mock失败/层检查局限、a21入口EACCES、各自清理和锁全部保留。本批无build/pull/push/save/export、OAuth/Registry/provider凭据读取生成、Cloudflare或门禁写入、PR合并及真实项目/模型/Turn/Run。该结果不证明原生root supervisor实际执行、持续线上可用、普通受邀工作流、完整JHG-56或全局零费用/执行。
