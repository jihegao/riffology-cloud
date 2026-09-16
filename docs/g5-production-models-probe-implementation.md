# Staging Worker只读地区403诊断

`ModelProxyService.probeProductionModels()`为私有service RPC，不新增HTTP路由。单独实现production-models-probe.ts，从现有生产profile固定account/gateway生成native GET /openai/models；现有两secret仅用于Authorization/CF Gateway请求头，结果不包含密钥、URL、原始provider错误、headers或账号ID。

独立于推理门禁，既不读取budget ledger、持久化对象、创建任务，也不改变任何gate/profile/价格。请求redirect:error、10秒timeout、最多一次GET、返回体流累计64KiB。固定cf-aig maxattempts1/skipcache/collectpayloadfalse。没有POST /responses、重试或fallback。

返回白名单status/errorCode/modelAvailable/inferenceCalls=0/readOnly/state；403且精确unsupported_country_region_territory映射region-blocked，其余403/401只auth-rejected。模型列表200只证明该执行出口下GET鉴权/模型可见，不能证明推理余额、完整Responses工具链、地区资格、invoice或未来线上任务一定可执行。探测失败不改变预算fence，不把GET当G5首准入。

3针对性测试及typecheck通过，覆盖固定GET无body/redirecterror、403白名单脱敏、redirect拒绝、64KiB限制、缺config零调用、畸形body/timeout/throw不输出raw。本轮仅本地测试；主控负责实际riffology-m1-gateway-staging部署、operator私有调用及临时资源清理。
