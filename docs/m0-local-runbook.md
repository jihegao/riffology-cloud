# M0 本地运行手册

本文用于复现本地检查和 M0 探针的可审计子集。探针是信任边界实验，不是产品后端；本地成功不能替代 staging 的 G0 验收，也不能证明云上的 VM、Preview、R2 或 Durable Object 行为。

## 1. 安装和静态检查

在仓库根目录执行：

```sh
npm ci
npm run check
npm run m0:preflight
```

`npm ci` 按仓库锁文件安装。最新 `npm run check` 为 189 项通过、1 项 opt-in Python 协议测试跳过，另有两个证据自检；[收据](evidence/runs/m0-local-20260905142451832/local-checks.json)记录 117 个源文件与日志摘要。覆盖 UI/TypeScript、checkpoint/Pi/Cloud worker、真实本地 FS、Preview policy、模型代理和受控 Pi 接线、release manifest。`m0:preflight` 默认只读核对版本、Git、锁文件和 Docker CLI/daemon；云能力不可用时报告 blocked。

如需保存本地前置报告，使用一个此前不存在的路径；工具使用排他创建，不会覆盖：

```sh
node scripts/m0/preflight.mjs --output=/tmp/riffology-m0-preflight.json
```

## 2. 可选的独立 Colima profile

当前 macOS 主控的本地基线是 Colima `0.10.3`、Docker CLI `29.8.0`、Docker server `29.5.2`、Buildx `0.37.0`。M0 使用独立 profile `riffology-m0`，启动参数为 `--cpu 2 --memory 4 --disk 20 --vz-rosetta --mount none --ssh-config=false --activate=false`，不会切换或修改全局 Docker context：

```sh
colima start --profile riffology-m0 --cpu 2 --memory 4 --disk 20 --vz-rosetta --mount none --ssh-config=false --activate=false
export DOCKER_HOST="unix://$HOME/.colima/riffology-m0/docker.sock"
docker version --format '{{.Client.Version}} / {{.Server.Version}}'
docker info --format '{{.ServerVersion}}'
```

项目 Docker 插件配置必须限制在项目本地路径，不要把全局 Docker 配置带入探针。创建一个没有凭据的配置目录并指向它；已有配置不覆盖，并显式允许 Homebrew buildx 插件目录：

```sh
umask 077
mkdir -p "$PWD/.local/docker"
export DOCKER_CONFIG="$PWD/.local/docker"
if [ ! -e "$DOCKER_CONFIG/config.json" ]; then
  node -e "require('node:fs').writeFileSync(process.env.DOCKER_CONFIG+'/config.json', JSON.stringify({cliPluginsExtraDirs:['/opt/homebrew/lib/docker/cli-plugins']}, null, 2)+'\\n', {flag:'wx', mode:0o600})"
fi
```

本地开发保持该目录不含登录凭据；Cloudflare OAuth 和供应商 key 不进入 Docker 配置、镜像层、日志或证据。已授权的云镜像推送会由 Wrangler 在此专用 `0600` 配置中临时写入短效 registry 登录，推送结束执行 `docker logout registry.cloudflare.com` 移除，只操作此项目的 `DOCKER_CONFIG`。若 Docker daemon 仍不可用，停止在这里并保留 `blocked` 结果。

## 3. 探针凭据和本地服务

`infra/.dev.vars.staging` 被 `.gitignore` 忽略，仅用于本地 staging 配置。仅生成随机的本地 Bearer 值；`ENVIRONMENT` 和 `PROTOCOL_VERSION` 由 Wrangler 配置注入，不要把值粘贴到终端记录或文档。若文件已存在，命令会拒绝覆盖：

```sh
umask 077
node -e "const {randomBytes}=require('node:crypto'); require('node:fs').writeFileSync('infra/.dev.vars.staging', 'M0_PROBE_TOKEN='+randomBytes(32).toString('hex')+'\\n', {flag:'wx', mode:0o600})"
```

Storage、Boundary 和文件探针是彼此独立的本地服务；按要复现的检查单独启动对应服务，不要求同时运行两个服务。既有 Storage/Boundary 服务仍可按需启动：

```sh
DOCKER_HOST="unix://$HOME/.colima/riffology-m0/docker.sock" \
DOCKER_CONFIG="$PWD/.local/docker" \
npm run m0:storage:dev
```

```sh
DOCKER_HOST="unix://$HOME/.colima/riffology-m0/docker.sock" \
DOCKER_CONFIG="$PWD/.local/docker" \
npm run m0:boundary:dev
```

它们分别监听 `127.0.0.1:8788`（storage）和 `127.0.0.1:8789`（boundary）。Storage Worker 没有公开 `/health`，所有路由都要求 Bearer；Boundary 才提供无需凭据的静态 `/health`：

```sh
curl --noproxy '*' -fsS http://127.0.0.1:8789/health
```

Boundary worker 的受保护路由要求 `Authorization: Bearer <M0_PROBE_TOKEN>`。从 `infra/.dev.vars.staging` 读取 token 仅应在本地进程内完成，输出和证据中只保留脱敏摘要；不要把 token 放在 curl 参数或命令行 argv。固定 probe 路由、输入限制、合成 fixture 和清理语义以 [spikes/m0-cloud/README.md](../spikes/m0-cloud/README.md) 为准。

## 4. 调用本地探针

Boundary 的 `GET /health` 只返回静态版本信息。Storage 的实际接口是带鉴权的 `POST /probe/{run_id}/run` 和 `GET /probe/{run_id}/report`；以下 Node 示例在进程内读取 token，不把它放入 argv：

```sh
node --input-type=module <<'NODE'
import { readFile } from 'node:fs/promises';
const token = (await readFile('infra/.dev.vars.staging', 'utf8')).match(/^M0_PROBE_TOKEN=(.+)$/m)?.[1]?.trim();
if (!token) throw new Error('missing local probe token');
const runId = `m0-local-${Date.now()}`;
const headers = { authorization: `Bearer ${token}` };
const run = await fetch(`http://127.0.0.1:8788/probe/${runId}/run`, { method: 'POST', headers });
console.log('run', run.status, await run.json());
const report = await fetch(`http://127.0.0.1:8788/probe/${runId}/report`, { headers });
console.log('report', report.status, await report.json());
NODE
```

默认模型 probe 不发送付费请求。真实供应商调用只由 [scripts/m0/pi-live-probe.mjs](../scripts/m0/pi-live-probe.mjs) 在显式 `--live` 且 `RIFFOLOGY_PI_PROBE_LIVE=1` 时启用，并要求通过环境变量注入 `RIFFOLOGY_PI_PROVIDER`、`RIFFOLOGY_PI_MODEL`、`RIFFOLOGY_PI_API_KEY`；不要在 runbook、命令行参数或证据中填写真实 key。先阅读脚本和审核预算，再决定是否执行。

## 5. 文件探针维护任务

文件探针使用独立的本地 Wrangler/Workerd 进程，监听 `127.0.0.1:8790`。先确保 Colima 和项目 Docker 配置已按上文设置，然后执行：

```sh
DOCKER_HOST="unix://$HOME/.colima/riffology-m0/docker.sock" \
DOCKER_CONFIG="$PWD/.local/docker" \
npm run m0:files:dev
```

仓库根目录的脚本定义应等价于：

```sh
wrangler dev --config infra/wrangler.m0-files.jsonc --env staging --local \
  --port 8790 --ip 127.0.0.1 \
  --var M0_EXECUTION_ENVIRONMENT:local-docker-workerd
```

管理接口只接受无 body、无 query 的固定路径；不接受任意 body、path 或 command：

| 方法 | 路径 | 用途 |
|---|---|---|
| POST | `/probe/<unique-run-id>/run` | 启动一次固定探针 |
| GET | `/probe/<unique-run-id>/report` | 读取报告 |
| POST | `/probe/<unique-run-id>/cleanup` | 清理该 run |

Bearer 值从已有 `infra/.dev.vars.staging` 在 Node 进程内读入内存，放入 `Authorization` header；不要在命令行使用 `-H` 打印 token，也不要把 token 写入日志或证据。示例：

```sh
node --input-type=module <<'NODE'
import { readFile } from 'node:fs/promises';
const token = (await readFile('infra/.dev.vars.staging', 'utf8')).match(/^M0_PROBE_TOKEN=(.+)$/m)?.[1]?.trim();
if (!token) throw new Error('missing local probe token');
const runId = `files-local-${Date.now()}`;
const headers = { authorization: `Bearer ${token}` };
const origin = 'http://127.0.0.1:8790';
const run = await fetch(`${origin}/probe/${runId}/run`, { method: 'POST', headers });
console.log('run', run.status, await run.json());
const report = await fetch(`${origin}/probe/${runId}/report`, { headers });
console.log('report', report.status, await report.json());
const cleanup = await fetch(`${origin}/probe/${runId}/cleanup`, { method: 'POST', headers });
console.log('cleanup', cleanup.status, await cleanup.json());
NODE
```

一次 run 执行固定项目的 20 次真实文件 CRUD，并校验文件内容/hash、目录、权限和删除结果；Worker 将 checkpoint 写入 R2，销毁项目运行时后从 R2 恢复，再次校验目录树和 generation。对同一 run 重复调用会返回持久报告，不会重跑；若进程中断，应清理旧 run 后使用新的唯一 run ID。已记录的本地证据是 [files-local.json](evidence/runs/m0-files-20260905061426155/artifacts/files-local.json)、[duplicate-run.json](evidence/runs/m0-files-20260905061426155/artifacts/duplicate-run.json) 和 [workerd-restart.json](evidence/runs/m0-files-20260905061426155/artifacts/workerd-restart.json)，后者证明 Worker 进程重启后仍读取到同一报告和两条事件。

报告中的 Session 是 Worker 创建的 synthetic Session，不是 real Pi Session；该探针的 `gate_decision` 仍为 `not_evaluated`，本地 Docker/Workerd 结果不替代云 G0。所有 Docker/Workerd 集成必须串行运行；并行 session 曾因共享同 digest 的镜像标签而互相影响。结束后停止本次 Wrangler，再检查本任务 Docker 容器及 `-proxy` helper 是否仍运行；Sandbox 销毁确认不涵盖开发代理的退出。只处理已核对名称和镜像的本次资源，不批量清理其他任务。不要把本地 TCP/HTTP 或 fixture 当作云权限、云隔离或云资源证明。

`infra/wrangler.m0-files.jsonc` 显式声明 `secrets.required`，并使用 `nodejs_compat_do_not_populate_process_env` 禁止自动注入 `process.env`；Worker 通过 env binding 读取配置。

可选的 Preview 集成见 [spikes/m0-preview/README.md](../spikes/m0-preview/README.md)，默认使用 `8791`，管理 secret 与签名 secret 必须是两个独立值。该集成仍是 synthetic probe，且不替代云 G0；不要复制其中的敏感启动片段。

如需可复现的本地 HTTPS fixture，先在仓库根目录执行：

```sh
node scripts/m0/preview-tls.mjs
```

脚本在 `.local/m0-browser-tls-<timestamp>-<random>/` 独占创建 `cert.pem`、`key.pem`、`vars.env` 和公开的 `metadata.json`；后者供既有 browser driver 读取固定 origin 与证书 SPKI 摘要。`key.pem` 和 `vars.env` 仅当前用户可读，两个 secret 独立随机生成。脚本不会改系统信任、hosts、浏览器或服务，也不打印 secret；成功时只打印 TLS 目录和 metadata 路径。将输出目录传给 [Preview README 的既有 TLS Wrangler 命令](../spikes/m0-preview/README.md#local-verification)，将返回路径赋给 `M0_PREVIEW_TLS_DIR`，随后在另一终端执行 `npm run m0:preview:browser -- "$M0_PREVIEW_TLS_DIR"`，并保持单个 Workerd 会话串行运行。

## 6. Recovery 中断与恢复探针

Recovery Worker 使用 `127.0.0.1:8793`，任务推进权属于 Durable Object alarm，SSE 只观察事件；Bearer 仍从 `infra/.dev.vars.staging` 在 Node 进程内读取。按需启动服务并运行集成：

```sh
DOCKER_HOST="unix://$HOME/.colima/riffology-m0/docker.sock" \
DOCKER_CONFIG="$PWD/.local/docker" \
npm run m0:recovery:dev
```

```sh
npm run m0:recovery:integration
```

脚本入口见 [recovery-local.mjs](../scripts/m0/recovery-local.mjs)，配置见 [wrangler.m0-recovery.jsonc](../infra/wrangler.m0-recovery.jsonc)。本地三场景均通过：[summary.json](evidence/runs/m0-recovery-20260905070637920/summary.json)、[disconnect.json](evidence/runs/m0-recovery-20260905070637920/disconnect.json)、[process.json](evidence/runs/m0-recovery-20260905070637920/process.json) 和 [container.json](evidence/runs/m0-recovery-20260905070637920/container.json)。process/container 命中真实 12 秒 SSE 流窗口并记录 kill/destroy、`finalAbsent`、新 sandbox generation、seed/hash/上下文恢复和旧事件拒绝；SSE 断开与 cursor 重放也有记录。[workerd-restart.json](evidence/runs/m0-recovery-20260905070637920/workerd-restart.json) 证明三场景报告、收据和事件在进程重启后保持一致；[storage-metadata.json](evidence/runs/m0-recovery-20260905070637920/storage-metadata.json) 覆盖事务元数据、并发父版本、失败回滚、单收据重放和旧 generation 拒绝。

Recovery 使用本地 SSE fixture，不访问外部供应商；本地通过不能关闭云 T08，云 `gate_decision` 仍为 `not_evaluated`。

### 6.1 本地发布策略探针

[发布策略探针](../spikes/m0-release/README.md)通过 `node --test spikes/m0-release/release.test.ts` 单独运行，也纳入 `npm run check`。8 个测试使用真实 Node 子进程和文件写入，验证版本准入、启动失败、旧任务版本固定、候选失败回退、checkpoint 摘要恢复和未知副作用不重放。两个 release 使用同一固定程序与不同启动参数，不代表两种真实镜像或云 rollout 已验证；无需启动 Docker，也不调用外部模型。

## 7. 保留证据

每次运行应保留脱敏的响应、命令、时间、环境、Git SHA、依赖/镜像版本和清理结果。证据路径必须是真实普通文件，放在证据根内；不要保存 token、Cookie、私有内容或完整认证输出。可用证据记录器写入独立 run 目录：

```sh
node scripts/evidence/recorder.mjs record --input ./redacted-g0-result.json \
  --root ./docs/evidence/runs --run 20260905-local-example
node scripts/evidence/recorder.mjs summarize --root ./docs/evidence/runs \
  --run 20260905-local-example
```

本地记录只能作为辅证。`summarize` 只有在十个 gate 都有 `case_id=gate-summary` 的 staging `passed` 且无 staging 非通过记录时才接受；当前没有因此产生任何真实通过结论。

## 8. 云前置流程

云检查必须单独显式执行，并先审核资源、账号、镜像 digest、绑定、Secret 名称、预算和清理方案：

```sh
node scripts/m0/preflight.mjs --cloud
```

该命令只读调用 `wrangler whoami`、`wrangler containers list` 和 `wrangler r2 bucket list`，不部署。旧的 [preflight.json](evidence/runs/m0-validation-20260905083304251/preflight.json) 与 [cloud-connector.json](evidence/runs/m0-validation-20260905083304251/cloud-connector.json) 保留为历史阻断记录。当前环境证据见 [cloud-before.json](evidence/runs/m0-environment-20260905094527503/cloud-before.json)、[bucket-create.json](evidence/runs/m0-environment-20260905094527503/bucket-create.json)、[bucket-verification.json](evidence/runs/m0-environment-20260905094527503/bucket-verification.json) 和 2026-09-05T09:46:34.008Z 的 [preflight.json](evidence/runs/m0-environment-20260905094527503/preflight.json)：指定私有 R2 bucket 已创建，4 项本地与 3 项 CLI 云检查均 passed。该配置检查不等于 Worker/DO/Containers 已部署或 G0 通过；后续仍需 secrets、模型代理/预算、域名/TLS 和验证矩阵。

### 8.1 已授权的 staging 复验

本轮已授权新增用量 **US$5，模型调用最多 US$1**，不含 Workers 月租；无需再次请求同一范围的部署或测试许可。实际账单尚未结算，不能把请求计数写成费用。最新资源与阻塞见[资源台账](m0-staging-resources.md)。

Storage 的 [T06 签收](evidence/runs/m0-g0-t06-cloud-20260905/G0-T06-gate-summary.json)覆盖真实 R2 上传中断、DO 提交前后实例终止、SSE 游标重放去重和限定前缀 GC；这项允许使用临时探针，不代替 M2/M5 生产链路。复验时先冻结 scoped 源码，dry-run 输出使用绝对目录，复制配置指向冻结 bundle，再以 `--no-bundle --secrets-file` 部署；API 和 CLI 核对活跃版本、R2/DO/Secret 绑定与 bundle 摘要后，才运行：

```sh
node --use-env-proxy scripts/m0/storage-cloud.mjs \
  --origin https://riffology-m0-storage-staging.jihe-gao.workers.dev \
  --secrets-file .local/cloud-staging/storage.secrets.json \
  --deployment-version "$M0_STORAGE_VERSION" \
  --bundle-sha256 "$M0_STORAGE_BUNDLE_SHA256"
```

两个变量须来自本次实际部署核验，不能照抄旧版本；参见[已执行部署记录](evidence/runs/m0-storage-cloud-bodyfix-20260905103521004/deployment-verified.json)。凭据文件只含 `M0_PROBE_TOKEN`、本用户所有、权限 `0600`，不能复用本地 `infra/.dev.vars.staging`。Runner 每次生成新 run ID，最多 60 请求、180 秒和 4 MiB 响应；未知 POST 只读对账，不自动重发。输出独占保存，旧失败证据保留。云端空 POST 也可能有空流，因此服务端鉴权后有界校验真实字节；不能用 `request.body === null` 判断请求合法性。

历史 Boundary 部署曾受镜像上传链路阻断；2026-09-06 已解除并完成[云部署与 VM 局部观测](m0-boundary-cloud-validation.md)。CLI 超时、`exitCode=null` 或镜像 manifest 未核实均不能写成成功：Worker 可能已经激活而容器尚未创建。历史[推送终态](evidence/runs/m0-boundary-staging-20260905100830706/push-reconciliation.json)记录无云实例启动、专用 Colima 的临时上传并发配置已恢复。重新部署仍应先验证 digest，不要反复重跑整套 deploy。

后续 [regctl 分块上传记录](evidence/runs/m0-registry-chunked-trusted-20260905111316067/result.json)使用已核验的 `regctl v0.11.5`、4 MiB chunk 和单并发；首个 30,649,033-byte layer 在 120 秒预算内失败，stderr 为 `failed to send blob (chunk), context canceled`，随后 HEAD 404，manifest 未发布、Container 未部署，未重试同一上传。`payloadBytesSubmitted` 是客户端输入而非网络实际字节，费用未知，模型请求与云 VM 为 0；该结果不证明 Registry 已支持 PATCH。

用户指定 `riff-demo.gaojihe.cn`；旧入口已退役，[新 Preview 入口](m0-preview-cloud-entry.md)已部署。准备入口和严格 manifest 见[Preview 手册](../spikes/m0-preview/README.md)；仍须真实 DNS、证书及独立 generation 子域名，不用本地 CA 或固定 workers.dev 主机池代替。

Boundary 云驱动在本机需用 `node --use-env-proxy scripts/m0/boundary-cloud.mjs`，其余参数按脚本现有接口提供；不关闭 TLS 校验。慢上传检查仍失败，先定位链路，不能删掉断言后把运行记为通过。

## 9. 当前边界和未完成项

当前 `npm run check` 覆盖 UI/TypeScript、checkpoint/Pi/Cloud worker、文件探针真实本地 FS 链路、Preview policy、Recovery runtime、子进程发布策略、release manifest 以及证据自检。文件、Recovery 和可选 Preview 集成另有本地 Docker/Workerd 实际链路；检查范围以各自记录为准。另有本地 Pi 真实供应商 probe 的历史记录，但仍缺云环境与供应商请求 ID 的完整关联证据，因此不能升级为 G0-T01 staging 验收。

T06 已单项签收，整体 G0 尚有九项待通过，M0 未完成。剩余范围包括真实云 VM 信任边界；真实 Pi Session 流式调用、取消和保存恢复；G0-T05 的云上 20 次真实 CRUD、销毁重建与长期恢复；G0-T07 Preview、子资源、WS、撤权与 Cookie/Origin；G0-T08 云 durable Turn、断线和 generation；G0-T09 完整出口与模型/依赖代理；G0-T10 云新旧 Worker/镜像协议、rollout、失败启动和回退。Recovery 本地三场景、Workerd 重启和事务 metadata 只证明本地原语与链路；原型 UI 的 `npm run dev`、`localworkerd` 或 `localDocker` 只能用于设计/本地开发观察，不能当作云验证、产品后端或发布完成。


### 模型代理的本地 fixture 验证

独立配置为 `infra/wrangler.m0-model-proxy.jsonc`，本地入口固定为 `http://127.0.0.1:8794`；使用 SQLite DO，不启动 Docker、Cloudflare 云资源或真实供应商。required secret 只有 `M0_PROBE_TOKEN`，不绑定供应商 key。启动时用独立 `.local` 内 0600 JSON 保存探针 token，通过 Node 子进程内存注入同名环境变量；Wrangler `--env-file` 指向空文件，避免载入其它探针 `.dev.vars.staging`。required secrets 过滤限制实际绑定。禁止把值写入命令参数或日志。

启动参数为 `wrangler dev --config infra/wrangler.m0-model-proxy.jsonc --env staging --local --port 8794 --ip 127.0.0.1 --env-file <empty-env-file> --persist-to <local-state-directory> --var M0_CONTROL_ORIGIN:http://127.0.0.1:8794`。服务 ready 后运行：

```sh
node scripts/m0/model-proxy-local.mjs --secrets-file .local/model-proxy-local/secrets.json
```

[当前本地收据](evidence/runs/m0-model-proxy-local-1788611379474-ec85ee9b/model-proxy-local.json)为 22 项通过、44 次业务与 2 次 cleanup 请求；四个 scope 均撤权，8794 开发服务已停止，UI 原进程保留。该收据验证显式同 call 取消、提前取消、撤权、DO 崩溃/重启后额度和不重放；单纯断开连接在 6 秒窗口未确认取消，保留失败记录，调用端必须使用 `/v1/cancel` 并回读状态。当前 pi-live 尚未接入此契约。

在同一 8794 Workerd 服务 ready 后，可运行真实独立 Pi 子进程到固定 loopback/SQLite DO fixture：

```sh
node scripts/m0/proxy-pi-local.mjs --secrets-file .local/model-proxy-local/secrets.json
```

[当前 Pi/Workerd 收据](evidence/runs/m0-proxy-pi-local-1788622591199-4e3a43ff/proxy-pi-local.json)记录 10 项通过、2,380ms、7 次控制与 2 次 cleanup 请求；3 次模型流和 1 次同 call 取消在 child 中另计。它验证 checkpoint 在进程 close 后以 0600/fsync 落盘、DO restart nonce 变化而账本保持、新 PID 从盘恢复完整历史、取消后独立 terminal 回读，以及所有 run revoke 后 `active=0`。child 不接 operator secret，父进程为每个 child 建临时目录并在 close 后回收，即使 SIGKILL 也清理。该 fixture 没有真实模型语义回忆，不是云 Pi/VM、生产身份、真实供应商或 G0 通过证据；T01 的两轮候选仍是两轮，不因本地验证改成三轮。首轮 9 case 收据见 [历史 artifact](evidence/runs/m0-proxy-pi-local-1788621797044-105263a8/proxy-pi-local.json)；中间一次因服务在 pre-health 前退出而为 0 case 失败，不覆盖本次收据。

[最新全检](evidence/runs/m0-local-20260905125007655/local-checks.json)和独立 dry-run 已通过；随后完成下述 staging fixture 部署与探针。没有新的供应商调用，本地和模拟云结果均不关闭 T01/T09。

### 模型代理的云端 fixture 验证

[已部署配置](evidence/runs/m0-model-proxy-staging-1788612744246/deployment-verified.json)固定为 `riffology-m0-model-proxy-staging`，版本 `06e097f1-cb6d-4349-8cf5-af4472ba0079`；SQLite namespace 为 `95df6344c3f64b0f82ae9431c3ff36fb`。Worker 只有 `MODEL_RUNS`、固定模式/协议/origin 和 `M0_PROBE_TOKEN`，没有供应商凭据、Container、R2 或真实模型 transport。独立 `.local/cloud-staging/model-proxy.secrets.json` 在首次开放路由之前通过 Wrangler secrets-file 注入，不与本地或其它 Worker 共用。

```sh
NODE_USE_ENV_PROXY=1 node scripts/m0/model-proxy-cloud.mjs \
  --secrets-file .local/cloud-staging/model-proxy.secrets.json \
  --deployment docs/evidence/runs/<fresh-verified-deployment>/deployment-verified.json
```

执行前先用只读 API 核验账号、100% 版本、bindings、SQLite namespace 和本地 bundle，生成新的部署核验记录。driver 只接受固定 staging HTTPS origin、仓库 evidence 路径中的证明、15 分钟内核验时间和完全相同的运行源码清单；不得仅改旧时间戳来复用过期证明。该命令自身不部署、不创建凭据、不启动 VM，也不自动重试变更请求。

上限为业务 120 秒、每请求 10 秒、60 请求、1 MiB 响应；异常清理另留 15 秒、4 请求、256 KiB。[本次云收据](evidence/runs/m0-model-proxy-cloud-1788613210899-49e0a3db/model-proxy-cloud.json)为 23/23、50 次业务请求、50,210 字节、34.347 秒。正常撤权和最终 GET 均计入业务预算，四个 run 的撤权记录不意味着用了 emergency cleanup；本次 emergency cleanup 请求为 0。最终 run 全部 revoked/active=0，realProviderCalls=0。未知派发预留保留，Synthetic μUSD 不代表云账单或模型扣费；真实费用待账单对账。

镜像发布前先使用[当前本地可审阅产物](m0-pi-proxy-image.md)确定目标仓库和公开范围；没有仓库授权不推送，不重复此前失败的同一上传。

### 受控 Pi 与代理的本地接线

```sh
node --test tests/m0/pi/proxy-pi.test.mjs
```

该命令仅启动自己的回环 HTTP fixture，运行真实 Pi SDK 和代理原语；不使用已有登录、供应商密钥、云操作员 secret、Docker 或外部网络。当前 13 项通过，完整执行与范围见[接线说明](m0-proxy-pi-bridge.md)及最新全检。云 Worker 的 23 项记录和此前镜像分别绑定旧有运行版本，不包含本客户端；后续云验证须重新接入、构建和核验。

### Pi 镜像入口检查

```sh
node scripts/m0/pi-image-check.mjs
```

本机运行验证真实 SDK 与固定 staging-fixture CLI 的注入 transport；Dockerfile 使用同一脚本且该 RUN 禁网。当前 Linux 构建与公开范围见[镜像记录](m0-pi-proxy-image.md)。该命令不连接真实代理、供应商或云 VM。
