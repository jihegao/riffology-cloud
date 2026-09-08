# M0 本地发布候选清单

`release-manifest.mjs` 只生成和复验本地候选；它本身不调用 Docker、Wrangler、网络或付费供应商。每次候选都必须先从当前源码生成 Wrangler dry-run JavaScript、运行当前 checks，并采集当前 Docker inspect 输入，再创建和复验 manifest。不要把旧 run 的检查结果、旧 bundle 或不存在的 `dist` 路径当作当前源码的证明。

先按[本地运行手册](m0-local-runbook.md)配置独立 Docker daemon 与无凭据的 `DOCKER_CONFIG`。在仓库根目录设置一个新的、未使用过的运行目录（以下 `<run-id>` 只作占位），并按顺序执行。输出目录用绝对路径，避免相对 Wrangler 配置目录产生歧义：

```sh
RUN_DIR="$PWD/.local/release-candidate-<run-id>"
mkdir -p "$RUN_DIR"

npx wrangler deploy --config infra/wrangler.m0.jsonc --env staging \
  --dry-run --outdir "$RUN_DIR/boundary-dry-run"
npx wrangler deploy --config infra/wrangler.m0-storage.jsonc --env staging \
  --dry-run --outdir "$RUN_DIR/storage-dry-run"

# 选取两个 dry-run 目录中 Wrangler 实际生成的 JavaScript bundle。
BOUNDARY_BUNDLE="$RUN_DIR/boundary-dry-run/<current-bundle.js>"
STORAGE_BUNDLE="$RUN_DIR/storage-dry-run/<current-bundle.js>"

node scripts/m0/record-local-checks.mjs
# 将上一步输出的 runDir 填入 CURRENT_CHECKS；不要复用旧 local-checks.json。
CURRENT_CHECKS="docs/evidence/runs/<current-check-run>/local-checks.json"

node --input-type=module - '<trusted-image-ref>' '<project-image-ref>' "$RUN_DIR/images-input.json" <<'NODE'
import { execFileSync } from 'node:child_process';
import { writeFile } from 'node:fs/promises';
const [trusted, project, output] = process.argv.slice(2);
const images = JSON.parse(execFileSync('docker', ['image', 'inspect', trusted, project], { encoding: 'utf8' })).map(item => ({
  id: item.Id,
  tags: item.RepoTags ?? [],
  architecture: item.Architecture,
}));
await writeFile(output, JSON.stringify({ observedAt: new Date().toISOString(), environment: 'local-docker', images }, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
NODE

node scripts/m0/release-manifest.mjs create \
  --boundary-bundle "$BOUNDARY_BUNDLE" \
  --storage-bundle "$STORAGE_BUNDLE" \
  --images-input "$RUN_DIR/images-input.json" \
  --checks "$CURRENT_CHECKS" \
  --out "$RUN_DIR/candidate.json"
node scripts/m0/release-manifest.mjs verify --manifest "$RUN_DIR/candidate.json"
```

将 `<current-bundle.js>` 替换为对应 dry-run 输出中的实际 `.js` 文件，将 `<trusted-image-ref>` 与 `<project-image-ref>` 替换为本次 Docker 构建实际使用的镜像引用；这些占位符不是可提交的路径或证据。

`record-local-checks.mjs` 会运行当前 `npm run check`，并在源码快照前后相同且检查成功时写出 `local-checks.json`。该文件必须有 `passed=true`、`sourceStableDuringCheck=true`，并包含完整当前源码清单。工具会复算 `services`、`spikes`、`scripts`、`tests`、`infra`、`ui` 以及根配置文件的每个 SHA-256，拒绝缺失、增加、篡改或不一致的来源。bundle、镜像输入、checks 和 manifest 路径必须在仓库内，逐级拒绝 symlink 和越界路径；镜像必须带完整 `sha256:` digest 与架构。

候选始终是 `environment=local`、`deployed=false`、`canPromote=false`，即使工作树干净。它记录文件摘要、依赖版本、源码树、Git HEAD 和 dirty 状态，不能证明构建来源、云门禁、staging 验收或已经部署。manifest 自身不是签名或信任根，正式发布仍需独立构建、云端门禁和部署后验证。

输出以 `wx` 创建，已有文件不会覆盖；请使用新的候选路径保留旧 run 的证据。
