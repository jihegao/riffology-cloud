# G5 冻结费率（2026-09-16）

生产契约：OpenAI API，gpt-5.6-luna，标准处理，经 Cloudflare AI Gateway 原生 OpenAI Responses 路由；平台 BYOK。不是 OpenCode Go 订阅通道。

主控实际读取的官方来源：[模型页](https://developers.openai.com/api/docs/models/gpt-5.6-luna)、[价格页](https://developers.openai.com/api/docs/pricing)、[Cloudflare OpenAI 路由](https://developers.cloudflare.com/ai-gateway/usage/providers/openai/)。标准短上下文输入 US$0.20/百万 token，cache-write US$0.25/百万，输出 US$1.20/百万；冻结采用较高输入价 250、输出 1200 nanodollars/token。输入上限 262144、输出上限 4096，低于 272K 长上下文输入阈值；不开 Fast、地区附加处理或上游托管工具。改变模型、计价条件、token 上限需另行冻结，不能复用本金额上界。

最坏每 Call US$0.0704512，8 Call/Turn US$0.5636096。147 dispatch 最坏 US$10.3563264；168 dispatch 最坏 US$11.8358016。这是保守预留计算，不是实测费用或 invoice 对账。冻结 USD 上限仍为每窗口 20、每 Turn 5、两窗口共享总额 40。

只读通道诊断：直接 OpenAI 模型列表此前 HTTP200；本次 Cloudflare Gateway 原生 OpenAI `/models` HTTP403，错误 code=`unsupported_country_region_territory`、type=`request_forbidden`。未触发模型推理。不得把 token active 或直接 models 可用视为该 Gateway 推理通道可用；生产开跑保持关闭，需提供符合上游服务地区要求的可用通道并重新核验。
