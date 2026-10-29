# JHG-46 fb07：SDK已部署，Dashboard与artifact通过；首次Report失败后已收尾

本结果记录2026-10-18/19原fb07批实际执行。用户接受[9c43已知idle自然替换修订](https://github.com/jihegao/riffology-cloud/blob/9c43df119219fd0fdf6251ddbe0184609c4047f4/docs/project-view-native-sdk-idle-placement-difference-proposal-20261019.md)后，按原窗口继续；未改原8f7/c65冻结输入或延长2026-10-19T01:59:00Z截止。**一个新项目、一个Session、两次Turn已保存并联合释放；首次host Report失败即停止，没有Retry、Session2/T3、V2或cold restore。父#214/JHG-46仍未完成。**

固定PR #257/fca66正常合并为004e5cd5940c6e283b1b58501c3f409a569f6e20。一次Gateway发布原ACK22:04:19.812Z，actual Worker d2660428-5ccb-4fb9-b1bd-d6b8ba26959f / deployment f32cef50-1c49-42ac-9514-b26837c68d24，bundle304373a5…/5,774,988B。前后各39 GET及完整16 app/版本/Registry/控制面保全通过；96项无Cookie公开GET完整53,784,755B全部匹配。frame观察顺序在请求前按闭门源码校正，实际在原R2释放及唯一PUT后只读取得7876B、SHA63ebcd05…，与固定frame相符；不将先前闭门行为写成曾发出frameGET。

T1/R1=768fc2ff…与T2/R2=0f8b8226…分别completed/saved，canonical checkpoint与Session head绑定，原runtime/tool/capacity及完整当前物理scope联合释放通过。T1两terminal工具、bash exit0、skill6056B/8ef3375d…；公开receipt不返回原精确script/timeout，故不宣称实际参数逐字验证。T2的原slash指令、R1唯一冻结skill、源码loader路径与成功事件共同支持actual-load推论；native load_resource未独立返回text/hash/receipt，不据此宣称已逐字读回该次native加载结果。T2保存manifest、双页、共享module/CSS、V1[2,3,5]和实际artifactId；原事件、工具效果与R2交付资产绑定，不靠模型文字证明保存。

V1实际Dashboard factor2=20/factor5=50、Pause/Resume输入更新通过。原生只读SDK真实list/read取得artifact两chunk（offset0/16384，16384+1183=17567B），独立重组正文SHA `1f1934a77952256ed99aa9cedcd923bea033cfb6239d81aa141d677faa4ab35a`，严格UTF8/JSON后验证envelope.content前缀；17408B是源文本，不是JSON artifact正文。当前包五资产与R2实际写回执一致，不把此项提升为Report通过或整个V1完成。

首次host Report选择后显示savedUnavailable、frame0；没有点击Retry或进入后续Session/Turn。Report文件存在，source诊断支持旧subscribed broker publish在切页主动dispose时abort、迟到reload catch未按generation/broker owner隔离而影响新frame的强竞态候选。但点击时刻、具体拒绝promise/stack/abort来源未完整捕获；HTTP超时也可AbortError，**不宣称唯一线上根因**。最小离线修复[#258](https://github.com/jihegao/riffology-cloud/issues/258)已In progress，#255仍Acceptance/P0/blocked；修复未合并、未部署、未验收。不通过再次提高timeout或重放本批绕过。

原有限gate请求95b9b8c6…只PUT一次201至open05d93023…/235；阶段失败后按原owned ACK/version/bodySHA只DELETE一次200。最终closed Worker **cb577ad1-4439-434b-aee2-326d647dc0d0 / 236**，latest sole100%。最终完整53GET确认gate absent，source3043、106bindings/11secret条目、25exports/6容器关联、96asset配置、16app/50namespace及原资源保全。raw stable81f81…与published d7d0…不同，精确secret注解预测桥另存比较值；不假称raw相等、任意忽略metadata或读取secret明文。

最终00:45:15.586–26.390Z原用户五GET全200，仍同R2、一Session/两completed-saved Turn、四active/hold字段clear、Beta available。00:45:27.292–29.734Z完整物理四GET显示11logical均inactive、Dash实例0/DO11，同d03b/v13/ec8下当前唯一2d986b84…已知basic/max1 idle VM running/container stopped，符合用户已接受的当前完整暴露scope条件；logical11不是VM11，不推旧placement历史处置或全局零VM。空闲VM可继续计费，usage/费用未知不记零。

原观察器171个GET中114为200、56为503、1个无观察status并保留AbortError；这不是完整浏览器packet capture，也不使已知保存释放的付费Turn变成unknown。Preview选择170→171不能证明poll停止；只有00:47:15.713Z完整document导航回项目列表后旧globals均absent/frame0，以及00:48:42Z原生AX确认Inspector关闭，才支持本次UI context退出。没有公开raw port/listener计数，不推全部历史进程/网络已停止。

[安全证据](../evidence/releases/project-view-native-sdk-publication-acceptance-execution-20261019/README.md)与[inventory](../evidence/releases/project-view-native-sdk-publication-acceptance-execution-20261019/inventory.json)保留独立原审阅和原件尺寸/SHA，完整private原始响应留本机；不公开身份、邮箱、原prompt/config/secret或精确host/location。原失败、请求、Revision、计量/预留、费用及锁全部保留。Browser Preview仍local/unverified；Report、完整双页V1、刷新/重入、Session2/T3/V2/cold restore与完整JHG-56仍未验收。
