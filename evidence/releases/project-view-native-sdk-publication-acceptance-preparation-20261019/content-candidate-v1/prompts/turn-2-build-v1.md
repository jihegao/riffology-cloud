/skill:native-pages-check 请从本次 Turn 的冻结 R1 项目资源加载该 skill，并按它完成 V1。不要把本条消息内的复述当作替代 skill；artifact按钮必须逐字采用该R1 skill内的readCheckedArtifact(api,id)参考函数，核连接原字节SHA后解析JSON envelope.content，不能对JSON串做源文本startsWith。沿用普通 Pi 项目工具和平台保存流程。

写入 app/views.json，内容严格为：
{"schema":"project.views/v1","files":["app/home.html","app/report.html","app/main.mjs","app/style.css","docs/series.json"],"views":[{"id":"home","title":"Dashboard","entrypoint":"app/home.html"},{"id":"report","title":"Report","entrypoint":"app/report.html"}]}

创建两个可切换 HTML 页、一份共享 module 和 CSS。用真实 riffoid.readFile('docs/series.json') 的 text 读取 series=[2,3,5]、version="V1"；factor 初始2显示20，改为5显示50。两页都展示 version/结果和 local/unverified 标记，并按 skill 提供暂停/继续、snapshot 订阅和明确的产物读取按钮。只用声明的本地资源、普通 DOM 和已存在的只读 riffoid API；不使用 fetch、外部依赖、新API、ModelSpec、trace 或服务端运行。

在本轮内使用一次有界 project_bash（timeout不超过30秒）生成 docs/native-artifact-probe.txt：内容为ASCII文字 native-artifact-probe-v1 后跟一个LF换行字节（0x0A），再补字符x，文件总长恰为17408字节。只创建这个合成文本文件，不运行网络、服务或安装命令。随后必须用普通 project_read 读取这个路径，让平台真实生成大结果的 tool-output artifact；不要用 project_read_page 替代这次生成，也不要捏造 artifactId 或 SHA。把实际返回的 artifactId 写入 docs/series.json 的 artifactId 字段，保留 version/series；该17KiB文件是保存的普通项目文件，不列入页面 manifest 的五个交付资产。

产物按钮应按 skill 真实 list/read chunks，展示实际 receipt 与累计 bytes/chunk 数；不能把source文件hash冒充artifact JSON结果hash。完成后正常结束并由平台保存 V1/R2；不要增加另一个Turn、不手工写回执、不直接改门禁或发布配置。工具、加载或保存失败时停止并报告，不fallback。
