/skill:native-pages-check 这是同一新项目中新建 Session2 的唯一 Turn。请从本次冻结 R2 项目资源重新加载原 skill，并先读取保存的 docs/series.json；不要依赖 Session1、浏览器或旧JS内存。

只修改 docs/series.json：version从V1改为V2，series从[2,3,5]改为[2,3,7]，原实际artifactId及其它字段保持。保留原 app/views.json、两个HTML页、共享main.mjs/CSS、skill和原17KiB合成文件的字节，不重新生成或project_read大文件，不重放旧工具。既有页面逻辑应显示factor2=24、factor5=60和V2；新页面实例通过已有只读API从保存内容重新构建，不能恢复旧JS内存来冒充冷恢复。

正常结束，由平台保存 V2/R3及本Session checkpoint；不要伪造Revision/保存成功或追加修复Turn。若实际R2资源、slash加载、普通工具或保存不符，只报告并停止，不创建新项目/替代Session/额外模型调用路线。
