# AMD128：M1 候选隔离复核指令

请在 AMD128 的独立工作目录复核同一份候选，不修改主线。负责人负责主线集成，你只返回证据和最小修复建议。关联 [#85](https://github.com/jihegao/riffology-cloud/issues/85)、[#214](https://github.com/jihegao/riffology-cloud/issues/214)、Linear JHG-46。

固定代码 commit：`eaf93973fd7e5f68d94b50c69884ae3d700bab32`；tree：`57f3eb1ed7cec34f9204ac84d37b4f798cd27436`。后续文档提交不改变本次验证对象。

## 本轮已通过 SSH 派发

用户已授权直接执行，主控于 2026-10-15 启动独立验证。GitHub/npm DNS 不通，使用 SSH 传输的源码和精确 Git tree 校验；本地重建 commit 元数据不同，不能冒充相同 commit SHA。原候选 eb81a2e 与本次修复使用不同临时目录。依赖锁文件一致，复用既有 node_modules；首轮 npm ci 失败保留，不记录为成功。结果见 PR #221 的最终证据。

## 环境和范围

使用无生产凭据的独立 Linux 用户/容器和全新 checkout。仅合成 fixtures、本机 loopback、临时存储；不调用线上模型、Wrangler deploy、生产 API 或旧项目，不改生产门禁。依赖安装需要 npm/Playwright 下载网络，与被测页面的联网能力分开记录。准备 Node 26.10.0（与集成本机一致；AMD128 本轮使用已有 Node 22.22.3，需保留该环境差异）、npm、Python 3、OpenSSL 3、Chromium 及其系统库。若只能用其他版本，先报告差异，不冒充同环境。

本任务不要求搭建新的远程浏览器服务。操作系统/容器隔离若未实际配置与验证，只能标记未覆盖；不能从 iframe 或 CSP 推断有 OS 网络隔离。已知导航问题尚未修复，生产通用页面必须保持禁用。

## 可直接执行

以下 bash 脚本创建独立目录、固定代码身份、逐项记录真实退出码；不要把已有工作目录覆盖掉。

```bash
set -euo pipefail
TASK_DIR=$(mktemp -d "${TMPDIR:-/tmp}/riffology-amd128-m1.XXXXXX")
git clone https://github.com/jihegao/riffology-cloud.git "$TASK_DIR/repo"
cd "$TASK_DIR/repo"
git fetch origin codex/m1-frozen-review-20261015
git checkout --detach eaf93973fd7e5f68d94b50c69884ae3d700bab32
test "$(git rev-parse HEAD^{tree})" = 57f3eb1ed7cec34f9204ac84d37b4f798cd27436
mkdir -p .local/amd128-evidence
EVIDENCE="$PWD/.local/amd128-evidence"
{ date -u; uname -a; node --version; npm --version; python3 --version; openssl version; git rev-parse HEAD HEAD^{tree}; git status --porcelain; } > "$EVIDENCE/environment.txt"
npm ci > "$EVIDENCE/npm-ci.log" 2>&1
npx playwright install chromium > "$EVIDENCE/browser-install.log" 2>&1
export M1_BROWSER_CHANNEL=chromium
run_check() {
  local name="$1"; shift
  set +e
  "$@" > "$EVIDENCE/$name.log" 2>&1
  local status=$?
  set -e
  printf '%s\t%s\n' "$name" "$status" | tee -a "$EVIDENCE/exit-codes.tsv"
}
run_check ui npm run check:ui
run_check types npm run typecheck
run_check focused node --test tests/m2/project-resources.test.mjs tests/m3/project-views.test.mjs tests/m3/project-views-gateway.test.ts tests/m3/project-view-artifact-commit.test.ts tests/m3/project-views-browser.test.mjs
run_check runtime node --test tests/m0/pi/controlled-pi.test.mjs tests/m2/trusted-pi-native.test.ts tests/m2/trusted-pi-release-candidate.test.mjs tests/m2/tool-artifact-store-workerd.test.mjs
run_check navigation node scripts/m3/project-view-navigation-repro.mjs
cp .local/project-view-isolation/navigation-egress-evidence.json "$EVIDENCE/" 2>/dev/null || true
# 现有完整回归仍依赖旧 Preview 静态资产；准备失败时保留失败，不声称完整检查通过。
run_check assets node services/browser-preview/runtime/prepare-assets.mjs
run_check execution-assets node services/browser-preview/execution/materialize.mjs
run_check web-assets node scripts/m3/materialize-browser-preview-web.mjs
run_check complete npm run check
git diff --check > "$EVIDENCE/diff-check.txt"
git status --porcelain > "$EVIDENCE/final-status.txt"
printf 'Evidence: %s\n' "$EVIDENCE"
```

Chromium 系统库缺失时由机器管理员按本机约定准备，再单独记录重跑，保留首轮失败。不要为了消除错误给被测页面添加平台凭据、宿主挂载、Docker socket 或生产网络权限。

## 重点审阅与判定

1. 非 loopback 的通用页面必须在读取 Workspace 内容前拒绝，execution worker 也必须拒绝。确认两层门禁均存在，不能仅验证 UI 隐藏。
2. 只读 broker 的 scope/generation、每次读取重新授权、取消后延迟响应、游标失效及保存/冷恢复均需检查；不能把 fixture 等同真实认证验收。
3. `navigation` **退出 0 表示已知缺陷复现成功，不是隔离通过**。JSON 必须有接收端实际收到的合成 canary，以及对应浏览器请求；仅请求事件、超时未收到、CSP 报错或 iframe 被销毁都不足以证明隔离。退出 1 表示本次未观察到或复现环境失败，应调查，不判修复。
4. Managed 已补显式 skill/prompt 加载与有界文本保存；模型自主 lazy-load 未接入，原生插件/宿主工具仍禁用。检查恢复不自动执行插件、不重放工具。资源超限阻断启动、模板参数展开无最终预算列为待修项，不扩大此次任务。
5. 新功能仍引用旧 Preview 的 sha256 模块和 execution worker；退役旧功能前需迁移通用依赖。Docker context 已补 allowlist，但镜像构建和真实云端运行尚未因此获验收。

## 返回给主线负责人

返回 commit/tree、机器/Node/浏览器/OS 隔离配置、每条命令退出码、pass/fail/skip、最小失败日志、navigation JSON 和未覆盖范围。只发送合成证据，先检查日志不含凭据。问题按“可复现缺陷／环境阻塞／未覆盖”区分，附文件行号和最小建议。若修复另建分支，不自行合并、部署或解除门禁。通过本轮也只算本地独立复核，不能将 #214/JHG-46 标为 Done。

## 后续隔离 Chromium 已执行

2026-10-15 按用户新授权在独立 `/tmp/riffology-browser-chain.Y24qNP` 构建本地镜像并执行完整合成链路。实际命令、镜像/策略身份、九种页面外发与中断清理证据见 [离线原型更新](project-view-offline-prototype-20261015.md) 与 [验收 JSON](../evidence/releases/amd128-isolated-chromium-20261015.json)。本节更新先前“真实浏览器未执行”的阶段状态；生产、真实项目/broker/UI仍未验收，旧原候选测试结果不改写。
