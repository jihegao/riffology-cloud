#!/usr/bin/env node
import {validateBrowserPreviewWebAssets} from '../m3/materialize-browser-preview-web.mjs';
import { lstatSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { isAbsolute, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

export const STAGING_CONFIG = 'infra/wrangler.gateway-staging.jsonc';
export const STAGING_ACCOUNT = '8b0d70250211aa10d89e20605a1c7e5e';
export const STAGING_ORIGIN = 'https://m1.riff-demo.gaojihe.cn';
export const STAGING_DATABASE = Object.freeze({
  name: 'riffology-catalog-staging',
  id: '993f2fd9-a135-4a93-9caa-10828dec6635',
});
export const STAGING_BUCKET = 'riffology-m1-workspace-checkpoints-staging';
export const REQUIRED_SECRETS = Object.freeze(['BETTER_AUTH_SECRET', 'GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET']);
const EXPECTED_DOS = ['PRODUCT_TURN_RUNTIME:ProductTurnRuntime', 'PROJECT_RUNTIME:ProjectRuntime', 'REVISION_STORE:RevisionStore', 'TENANT_QUOTA:TenantQuota', 'WORKSPACE_AGENT:WorkspaceAgent'];
const LEGACY = /riffology-demo|riffology-m0|local-catalog|workers\.dev|\.preview\.riff-demo\.gaojihe\.cn/i;
const TIMEOUT = 60_000;

const same = (actual, expected) => JSON.stringify(actual) === JSON.stringify(expected);
const check = (name, passed, detail) => ({ name, status: passed ? 'passed' : 'failed', ...(passed || !detail ? {} : { detail }) });
const sorted = values => [...values].sort();

export function validateStagingConfig(config, dockerfile, migrationNames = []) {
  const serialized = JSON.stringify(config);
  const route = config.routes?.[0];
  const database = config.d1_databases?.[0];
  const bucket = config.r2_buckets?.[0];
  const container = config.containers?.[0];
  const dos = (config.durable_objects?.bindings ?? []).map(item => `${item.name}:${item.class_name}`);
  const exports = config.exports ?? {};
  const from = dockerfile.match(/^FROM\s+([^\s]+)$/m)?.[1] ?? '';
  return [
    check('worker-name', config.name === 'riffology-m1-gateway-staging'),
    check('account', config.account_id === STAGING_ACCOUNT),
    check('no-legacy-or-fallback', !LEGACY.test(serialized)),
    check('single-custom-domain', config.workers_dev === false && config.preview_urls === false
      && config.routes?.length === 1 && route?.pattern === new URL(STAGING_ORIGIN).host && route?.custom_domain === true),
    check('origin', config.vars?.APP_ORIGIN === STAGING_ORIGIN),
    check('quota', config.vars?.TENANT_QUOTA_CAPACITY === '1' && config.vars?.TENANT_QUOTA_POLICY_VERSION === 'm1-v1'),
    check('turn-runtime-gate', config.vars?.M2_TURNS_ENABLED === 'false'),
    check('assets', config.assets?.binding === 'ASSETS' && config.assets?.directory === '../.local/browser-preview/gateway-assets'
      && config.assets?.run_worker_first === true),
    check('required-secrets', same(sorted(config.secrets?.required ?? []), sorted(REQUIRED_SECRETS))),
    check('dedicated-d1', config.d1_databases?.length === 1 && database?.binding === 'CATALOG'
      && database?.database_name === STAGING_DATABASE.name && database?.database_id === STAGING_DATABASE.id
      && database?.migrations_dir === '../services/catalog/migrations'),
    check('dedicated-r2', config.r2_buckets?.length === 1 && bucket?.binding === 'WORKSPACE_CHECKPOINTS'
      && bucket?.bucket_name === STAGING_BUCKET),
    check('durable-objects', same(sorted(dos), EXPECTED_DOS)),
    check('do-exports', same(Object.keys(exports).sort(), ['ProductTurnRuntime', 'ProjectRuntime', 'RevisionStore', 'TenantQuota', 'WorkspaceAgent'])
      && exports.TenantQuota?.type === 'durable-object' && exports.TenantQuota?.storage === 'sqlite'
      && exports.WorkspaceAgent?.type === 'durable-object' && exports.WorkspaceAgent?.storage === 'sqlite'
      && exports.ProductTurnRuntime?.type === 'durable-object' && exports.ProductTurnRuntime?.storage === 'sqlite'
      && exports.RevisionStore?.type === 'durable-object' && exports.RevisionStore?.storage === 'sqlite'
      && exports.ProjectRuntime?.type === 'durable-object' && exports.ProjectRuntime?.storage === 'sqlite'
      && exports.ProjectRuntime?.container === 'riffology-m1-project-staging' && config.migrations === undefined),
    check('container-budget', config.containers?.length === 1 && container?.name === 'riffology-m1-project-staging'
      && container?.class_name === 'ProjectRuntime' && container?.image === '../services/runtime/Dockerfile.cloud'
      && container?.instance_type === 'basic' && container?.max_instances === 2),
    check('cron-disabled', config.triggers === undefined),
    check('pinned-runtime-base', /^node:22\.19\.0-bookworm-slim@sha256:[a-f0-9]{64}$/.test(from)
      && /\nUSER node\n/.test(dockerfile) && /\nWORKDIR \/workspace\n/.test(dockerfile)),
    check('catalog-migrations', same(migrationNames, [
      '0001_catalog.sql', '0002_auth.sql', '0003_provisioning.sql',
      '0004_operator_invitations.sql', '0005_initial_operator.sql', '0006_model_catalog.sql','0007_model_content_checks.sql','0008_preview_routes.sql','0009_model_submissions.sql','0010_project_budget_routes.sql','0011_user_locale_preferences.sql','0012_project_archives.sql',
    ])),
  ];
}

export function validateSecretFile(path) {
  if (!path) return { name: 'deployment-secrets', status: 'blocked', detail: 'secrets-file-not-supplied' };
  try {
    const stat = lstatSync(path);
    if (!stat.isFile() || stat.isSymbolicLink() || (stat.mode & 0o077) !== 0) return check('deployment-secrets', false, 'secrets-file-permissions');
    const value = JSON.parse(readFileSync(path, 'utf8'));
    const keys = Object.keys(value).sort();
    return check('deployment-secrets', same(keys, sorted(REQUIRED_SECRETS))
      && keys.every(key => typeof value[key] === 'string' && value[key].length >= 16), 'secret-shape');
  } catch {
    return { name: 'deployment-secrets', status: 'blocked', detail: 'secrets-file-unreadable' };
  }
}

function command(args) {
  return spawnSync('npx', ['wrangler', ...args], { cwd: resolve(fileURLToPath(new URL('../..', import.meta.url))),
    encoding: 'utf8', timeout: TIMEOUT, maxBuffer: 4 * 1024 * 1024, env: process.env });
}
function cloudInventory() {
  const checks = [];
  for (const [name, args, match] of [
    ['cloud-d1', ['d1', 'list', '--json'], output => {
      try { return JSON.parse(output).some(item => item.name === STAGING_DATABASE.name && item.uuid === STAGING_DATABASE.id); } catch { return false; }
    }],
    ['cloud-r2', ['r2', 'bucket', 'list'], output => output.includes(STAGING_BUCKET)],
  ]) {
    const result = command(args);
    checks.push(check(name, result.status === 0 && match(result.stdout), result.status === null ? 'timeout' : 'resource-not-found'));
  }
  return checks;
}
function dryRun() {
  const outdir = mkdtempSync(resolve(tmpdir(), 'riffology-m1-dry-run-'));
  try {
    // Bundle and validate every binding without building or rolling out the
    // container. Dockerfile integrity is checked separately above.
    const result = command(['deploy', '--config', STAGING_CONFIG, '--dry-run', '--containers-rollout=none', '--outdir', outdir]);
    return check('wrangler-dry-run', result.status === 0, result.status === null ? 'timeout' : 'wrangler-rejected-config');
  } finally { rmSync(outdir, { recursive: true, force: true }); }
}

export function runPreflight({ root = resolve(fileURLToPath(new URL('../..', import.meta.url))), cloud = false,
  dryRunEnabled = false, secretsFile = null } = {}) {
  const config = JSON.parse(readFileSync(resolve(root, STAGING_CONFIG), 'utf8'));
  const dockerfile = readFileSync(resolve(root, 'services/runtime/Dockerfile.cloud'), 'utf8');
  const migrationNames = readdirSync(resolve(root, 'services/catalog/migrations')).filter(name => /^\d{4}_.+\.sql$/.test(name)).sort();
  const checks = [...validateStagingConfig(config, dockerfile, migrationNames),validateBrowserPreviewWebAssets(root)];
  if (cloud) checks.push(...cloudInventory());
  if (dryRunEnabled) checks.push(dryRun());
  checks.push(validateSecretFile(secretsFile ? resolve(root, secretsFile) : null));
  const status = checks.some(item => item.status === 'failed') ? 'failed'
    : checks.some(item => item.status === 'blocked') ? 'blocked' : 'passed';
  return { schemaVersion: 1, observedAt: new Date().toISOString(), status, checks };
}

function main() {
  const args = process.argv.slice(2);
  const output = args.find(arg => arg.startsWith('--output='))?.slice('--output='.length);
  const secretsFile = args.find(arg => arg.startsWith('--secrets-file='))?.slice('--secrets-file='.length) ?? null;
  if (args.some(arg => !['--cloud', '--dry-run'].includes(arg) && !arg.startsWith('--output=') && !arg.startsWith('--secrets-file='))) throw Error('unsupported-argument');
  const result = runPreflight({ cloud: args.includes('--cloud'), dryRunEnabled: args.includes('--dry-run'), secretsFile });
  const text = `${JSON.stringify(result, null, 2)}\n`;
  if (output) {
    const target = resolve(process.cwd(), output);
    if (isAbsolute(output) && target !== resolve(output)) throw Error('invalid-output');
    writeFileSync(target, text, { flag: 'wx', mode: 0o600 });
  } else process.stdout.write(text);
  if (result.status !== 'passed') process.exitCode = 2;
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { main(); } catch (error) { console.error(`m1 staging preflight: ${error instanceof Error ? error.message : 'failed'}`); process.exitCode = 1; }
}
