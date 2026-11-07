这是未来新批候选的第1次普通 Pi Turn。先仅使用一次有界普通 project_bash，参数 script 必须精确为 `mkdir -p -- .pi/skills/native-pages-check`，timeoutMs 为 30000；命令在平台原项目工作目录内执行，只创建这一路径的缺失目录，不切换目录、不访问网络、不运行其它代码或安装/服务命令。仅在该命令明确成功后，通过普通 project_write 创建 .pi/skills/native-pages-check/SKILL.md。内容必须逐字按下面代码块写入，保留其LF结尾；不要在本轮创建页面。保留 blank 项目既有文件。写入后可用普通读取工具核对文件内容，然后正常结束，让平台执行本轮 canonical 文件与 Session checkpoint 保存；不要调用不存在的“保存 Revision”工具，也不要仅在回复中展示文件。目录命令、写入或保存失败/未知时停止，不重试或追加Turn。

```markdown
---
name: native-pages-check
description: Build and revise a small saved two-page browser-local project using authorized file and artifact reads.
---
Use ordinary project tools and preserve unrelated project files. Do not start services, install dependencies, run a server simulation, use ModelSpec/trace, call a provider directly, or change permissions.
Create app/views.json with exactly this project.views/v1 shape: schema, files, views. Declare app/home.html, app/report.html, app/main.mjs, app/style.css and docs/series.json. Declare two views: home/Dashboard/app/home.html and report/Report/app/report.html. Do not list app/views.json or this skill in manifest.files.
Both HTML entries use the same local ./main.mjs module and ./style.css; navigate with declared relative HTML links and the normal host tabs. No external dependencies, bare module imports, fetch, credentials or invented SDK methods.
Use the actual window.riffoid API: readFile('docs/series.json') resolves an object with text; listArtifacts(cursor) returns items/nextCursor; readArtifact(artifactId,offset) returns receipt/offset/base64/nextOffset; subscribe(listener) resolves an unsubscribe function. These APIs are read-only. Read saved data through readFile, not network fetch.
Data is {version:'V1' or 'V2',series:[numbers],artifactId:actual tool-output artifact id}. Show its version, a factor number input initially2, and sum(series)*factor. Both pages must show factor2 and factor5 results correctly. Include Pause/Resume for input-driven updates and a browser-local/unverified label. A fresh frame restores factor2 from saved source, not unsaved JavaScript memory.
Subscribe once to current-package snapshots, display the observed revision/package identity, and cancel that subscription on pagehide. Never create canonical writes or tool/model calls from the page.
Provide an explicit artifact-check button. Paginate listArtifacts until the actual saved artifactId is found; read that id starting offset0 and continue returned nextOffset until null. Decode base64 bytes and check accumulated size against receipt.bytes; show id, receipt.sha256, bytes and chunk count. Parse the artifact's application/json envelope and check the read result's content begins with native-artifact-probe-v1 followed by a newline. Do not assume the artifact SHA equals the source text file SHA, or claim verification before the observed bytes are independently hashed.
For a revision update, preserve manifest, both pages, module, CSS, this skill and artifactId; only change docs/series.json version/series as requested. End normally so the platform commits this Turn's canonical files and Session checkpoint; do not invent a save API.
```

本轮只准备供后续 Turn 从冻结 Revision 加载的 skill；不要在当前 Turn 内声称已经加载这个刚写入的 skill。若普通工具或保存失败，如实停止，不绕路。
