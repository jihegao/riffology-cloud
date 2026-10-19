# c263 单行授权传输修复候选（未恢复执行）

原[c263/6fd准备](https://github.com/jihegao/riffology-cloud/blob/d948b08324d288c1c88d428d5331acfff2d03121/docs/project-view-trusted-pi-native-resource-snapshot-host-publication-packet-20261018.md) 已按新授权实际开始，正常同六scope token命令与身份读取已发生，但SSH exit1、stdout0、stderr771B且无remote safe events；Registry credential POST/stdin均false，未merge253。全局或历史费用不记零。

[实际输入纯诊断](evidence/actual-grant-wire-diagnosis.json) 证明：完整grant4632B是有效授权JSON，冻结producer保持多行，remote readline只收2B `7b0a` 后在ROOT.mkdir前JSON解析失败。未保存的原stderr文本不能被本地预测替代。[原local终态](evidence/original-local-terminal.json) 与[独立原身份回读](evidence/original-stopped-readback.json) 分开报告；后者12:21:53Z确认ROOT/records/archive/auth不存在、7897无LISTEN/connect111，原SSH和正常token CLI均已不存在。

修复保留原request `c263a2f3-f445-430e-b562-2e48f1eeb637`、remote sibling/tag/source0bb/49层；新建本机repair-once执行副本，原once锁和所有失败历史不动。唯一逻辑变化是 [local driver](local-recovery.py) 的inputs在Auth和STATE前要求恰一条JSON、恰一个末尾LF、无CR，producer输出必须逐byte等于原grant，并由真实冻结c.grant验证该行。缺少LF也拒绝，避免remote的humanGrantSHA漂移。remote/OCI/common/scope/reader/续期合同均与6fd逐字相同。[操作件manifest](operations-manifest.json) · [完整source绑定](candidate-source-binding.json)。

[3项新本地pure检查](offline-checks.safe.json) 于2026-10-18 20:24:42 Asia/Shanghai通过；旧17操作fake与11reader fixture只保留历史归属、未重跑。无OAuth读取/CLI认证、SSH、Docker、RegistryAPI或provider执行。本包不包含human grant/答复、OAuth、原rawstderr或配置正文。

恢复须新的具体人类授权，明确已消费原一次token/route，允许同原c263的一次额外正常token读取/同权限续期及一次额外SSH控制路由，以完成仍未尝试的唯一export/push。实际新grant必须compact JSON+恰一末尾LF，绑定新manifest。root须先按原身份再次确认未出现ROOT/归档/凭据/执行；缺失或unknown仍停止，不自动重试。固定镜像source仍0bb，runnable/config未知，后续原完整rawblob/49diffID验证、一次push与独立cleanup合同不变；不重建/不pull/不清旧锁/不新请求绕行。

[操作说明](EXECUTION.md) 与[授权边界](AUTHORIZATION.md) 明确条件PR253普通合并仍由root在真实发布/独立清理/fresh固定head检查后单独执行，不给AMD GitHub凭据。无应用rollout、Gateway/gate、新Turn/Run/模型/项目，不延长或挪用原真实验收窗口。JHG-46仍未完成。
