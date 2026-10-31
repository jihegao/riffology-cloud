# GaoAgent 模型入口

GaoAgentModel 是 gaojihe.cn 个人助手的命名 Worker 服务入口，仅通过 Service Binding 调用。默认关闭，GAOAGENT_MODEL_ENABLED 必须为字符串 true 才执行模型请求。原 Gateway 的公共路由不增加匿名推理接口。

入口固定 gpt-6-luna、Responses、low、stream=true、store=false。普通问答和建模请求允许 max_output_tokens 为2048或8192，函数工具限 knowledge_search、knowledge_get 和 web_search。调用端默认使用8192作为 JavaScript 建模回复预算，浏览器运行结果仍是 local/unverified。

在线搜索采用独立且受限的 Responses 请求：tools 只能是单个不带额外字段的 `{type:"web_search"}`，tool_choice 必须为 required，max_tool_calls 必须为1，max_output_tokens 必须为2048，instructions 固定为 `Search the web and provide a concise factual summary with citations.`。input 只能是一条 role=user、非空且长度不超过500的字符串查询，不接受额外 input 字段。普通函数工具请求不能设置 max_tool_calls。

请求采用 UTF-8 字节加4096的保守输入上界32000；使用 prompt_cache_options explicit 模式，不转发旧 prompt_cache_retention。上游请求同时遵守调用方取消信号和60秒超时，没有自动 retry/provider fallback。

此入口读取原有 PRODUCTION_OPENAI_API_KEY 和 PRODUCTION_AI_GATEWAY_TOKEN，以现有 production profile 的 gateway 身份构造固定 OpenAI endpoint。凭据不导出给 GaoAgent Worker、Pi 容器或浏览器。原仿真 Pi 的模型、profile、容量 actor 和历史账本不修改；本项独立于 #209。

调用端由网站仓库的 GaoQuota 原子执行每日100轮、同键去重和单会话/全站并发，并将实际 token usage 单独持久化。Pi harness 每轮最多3次主模型调用和1次 hosted 搜索，合计最多4次模型调用。部署前必须验证新服务绑定及调用端准入；该入口不是可供其他公开路由直接使用的通用模型代理。

验证：PR #261 的 Gateway 原仓库回归、类型与打包已通过，入口现已由用户授权启用。2026-10-28 的输入预算修复通过2项策略测试，使用保留配置的源码替换发布为 `191e6d4a-b893-4490-ae37-e2751d9d08ba`；原 `index.js` 完全一致，107个绑定（含11个Secret）回读一致。正式站 gpt-6-luna 项目问答已返回 GitHub 来源引用。网站的工具收口与回归证据见 [修复 PR](https://github.com/jihegao/gaojihe-cn/pull/3)。

2026-10-31，[JHG-104](https://linear.app/jhgao/issue/JHG-104/gaoagent上线自动在线搜索与对话式-javascript-建模预览) 将上述搜索协议、建模输出预算和60秒超时同步到正式源码，防止后续全量构建覆盖已发布的 GaoAgent 模块。[网站实现 PR #13](https://github.com/jihegao/gaojihe-cn/pull/13) 保存调用端和对话预览。Gateway 版本 `dcdbf293-9645-494f-9220-62210b1723c6` 已切换为100%流量；上传后完整资源配置读回保持一致，包括108个绑定（11个Secret）、26个导出、6个容器关联和现有静态资产，只有代码 etag 与上传来源 api→wrangler 变化，非版本设置未更新。

两个源文件与该版本构建输入逐字节一致：gaoagent-entrypoint.mjs 的 SHA-256 为 `d8657e8ee26a30cbaa6b7bc414e5dc657c51543676a6af26f84ab73c3d5daa2e`，gaoagent-model-policy.mjs 为 `c05142d792511e9be4d9e74898a6254313dc53bb4dabdc3a7cee33a5efbeb9d4`。本次源码 PR 只持久化这两个模块、策略回归和本说明，不重复部署；网站真实搜索/建模及浏览器验收由 JHG-104 单独记录，源码检查不能替代这些验收。

关联：#260 · [网站实现 PR](https://github.com/jihegao/gaojihe-cn/pull/1)。站点配置和部署顺序见该 PR 的 agent/README.md。
