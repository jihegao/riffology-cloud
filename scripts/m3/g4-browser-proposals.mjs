// Proposal strings only. Importing this file creates no browser, task or network call.
export const initialPrompts={
 mesa:`请在这个空白项目中创建一个可保存并本地播放的 Mesa Schelling 分离模型。研究问题：邻居相似偏好提高，是否会增加居住分离？使用合成居民，无真实个人数据。参数包括 steps（默认8，上限200）、width（默认8，上限12）、height（默认6，上限10）、density（默认0.75）、minority_fraction（默认0.35）、homophily（默认0.5）；参数边界必须明确且有效。指标至少包括 unhappy_fraction 与 segregation，输出逐步网格和指标。遵循平台已安装的 Browser Preview 固定生成技能，保存 Model Spec、共享 model.py、平台规范 server wrapper、visualization 和精确依赖锁；使用固定 Mesa 六包，不另加依赖。模型运行由传入 config 的参数和 seed 决定，所有随机选择可复现，无网络/子进程/文件外部副作用。不要启动服务、提交 Experiment/比较组或把本地指标声明为服务器验证结果。完成后说明研究假设、参数、保存状态与限制。`,
 queue:`请在这个空白项目中创建一个可保存并本地播放的纯 Python 标准库排队模型。研究问题：增加服务器数，是否降低平均等待时间？使用合成到达/服务时间；默认 servers=2、customers=30、arrival_rate=0.8、service_rate=1，customers 明确范围1–5000，servers 范围1–8，其余正数且给出有效边界。指标至少包括 mean_wait 和 max_wait；逐事件显示等待/服务队列。遵循平台已安装的 Browser Preview 固定生成技能，保存 Model Spec、共享 model.py、平台规范 server wrapper、visualization 和空 packages 依赖锁；仅用 CPython3.11 兼容语法和标准库。模型由传入 config 参数和 seed 决定，所有随机选择可复现，无网络/子进程/外部副作用。不要启动服务、提交 Experiment/比较组或把本地指标声明为服务器验证结果。完成后说明研究假设、参数、保存状态与限制。`
};
export const revisionPrompts={
 mesa:`基于已有 Schelling 模型修改机制假设：原先允许迁居到任意空位，改为在随机抽取最多5个空位中优先选择邻居相似度最高的位置；若没有更好候选则保持原位。请实际修改 model.py 与 Model Spec 假设/限制并保存新 Revision，保持参数和指标、固定依赖锁及可播放协议兼容。不要提交服务器实验或服务。明确说明这是机制干预而不是对研究结论的验证。`,
 queue:`基于已有 Queue 模型把服务时间假设从指数分布改为固定服务时长1/service_rate。请实际修改 model.py 与 Model Spec 假设/限制并保存新 Revision，保持参数、指标、空依赖锁、CPython3.11 兼容和可播放协议。不要提交服务器实验或服务。明确说明应由同样 seeds 的后续服务器实验比较，而不是将历史结果换成新模型结果。`
};
// Optional alternative to one revision branch, never an extra automatically scheduled Turn.
// Unsupported-source + recovery consumes two explicit Turns; root must choose within remaining budget.
export const unsupportedProposal=`仅针对这个合成测试项目，保存一个明确不在 Browser Preview 依赖白名单内的新版本：requirements.lock 声明 sympy==1.13.3，model.py 顶部 import sympy。保留其余模型文件和输入/指标接口，不下载或安装该包，不执行模型，不启动服务或提交实验。此修改仅用于验证平台保存后明确显示 unsupported；不要伪装为成功的本地模型。`;
export const recoveryProposal=`撤销刚才测试引入的 sympy 依赖和 import，恢复 Queue 模型的空 packages 锁及纯标准库代码，同时在 Model Spec 限制中注明服务时间仍为原先约定。实际保存新 Revision。不要下载依赖、启动服务或提交实验；保存后由用户检查新的 Browser Preview 构建状态，历史版本应仍保留其原状态。`;
export const selectors={create:'#project-submit',title:'#project-title',model:'#project-model',session:'#session-select',message:'#message-input',turn:'#message-submit',localAction:name=>`[data-browser-preview-action="${name}"]`,parameter:name=>`[data-parameter="${name}"]`,seed:'[data-browser-preview-seed]'};
export function groupBody(version,hypothesis,baseline,intervention,seeds=[7,8,9]){return {...version,hypothesis,baseline:{label:'baseline',parameters:baseline},interventions:[{label:'intervention',parameters:intervention}],seeds};}
