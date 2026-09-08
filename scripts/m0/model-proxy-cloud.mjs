import { readFileSync } from 'node:fs';
import { resolve, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { safePath, sourceSnapshot } from './source-inventory.mjs';
import { STAGING_ORIGIN, readOperatorToken, runModelProxyProbe } from './model-proxy-local.mjs';

const root = resolve(fileURLToPath(new URL('../..', import.meta.url)));
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const runtimePath = path => /^spikes\/m0-model-proxy\/.*\.ts$/.test(path) || ['spikes/m0-cloud/auth.ts', 'infra/wrangler.m0-model-proxy.jsonc', 'package.json', 'package-lock.json', 'tsconfig.json'].includes(path);

export function parseArguments(argv) {
  const values = {};
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index];
    if (!['--secrets-file', '--deployment'].includes(key) || values[key] || !argv[index + 1] || argv[index + 1].startsWith('--')) throw new Error('invalid-model-proxy-cloud-options');
    values[key] = argv[index + 1];
  }
  if (Object.keys(values).length !== 2) throw new Error('secrets-file-and-deployment-required');
  return { secretsFile: values['--secrets-file'], deploymentFile: values['--deployment'] };
}

export function validateDeployment(deployment, snapshot, now = Date.now()) {
  if (!deployment || deployment.verified !== true || deployment.mode !== 'fixture-only' || deployment.origin !== STAGING_ORIGIN
    || deployment.accountId !== '8b0d70250211aa10d89e20605a1c7e5e' || deployment.scriptName !== 'riffology-m0-model-proxy-staging'
    || !uuid.test(deployment.versionId ?? '') || !/^[a-f0-9]{64}$/.test(deployment.bundleSha256 ?? '')
    || !Number.isSafeInteger(deployment.verifiedAtMs) || now < deployment.verifiedAtMs || now - deployment.verifiedAtMs > 900000
    || !Array.isArray(deployment.sourceFiles)) throw new Error('fresh-verified-fixture-deployment-required');
  const expected = snapshot.files.filter(file => runtimePath(file.path));
  if (!expected.length || deployment.sourceFiles.length !== expected.length
    || JSON.stringify(deployment.sourceFiles) !== JSON.stringify(expected)) throw new Error('deployed-runtime-source-mismatch');
  return { mode: deployment.mode, origin: deployment.origin, accountId: deployment.accountId, scriptName: deployment.scriptName,
    versionId: deployment.versionId, bundleSha256: deployment.bundleSha256, verifiedAtMs: deployment.verifiedAtMs, verified: true,
    sourceFiles: deployment.sourceFiles };
}

export function readDeployment(input) {
  const path = safePath(root, resolve(root, input), 'deployment evidence');
  if (!relative(root, path).startsWith(`docs${sep}evidence${sep}runs${sep}`)) throw new Error('deployment-evidence-path-required');
  return validateDeployment(JSON.parse(readFileSync(path, 'utf8')), sourceSnapshot(root));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const options = parseArguments(process.argv.slice(2));
    const deployment = readDeployment(options.deploymentFile);
    const result = await runModelProxyProbe({ token: readOperatorToken(options.secretsFile), origin: STAGING_ORIGIN, deployment });
    console.log(JSON.stringify(result));
    if (!result.passed) process.exitCode = 1;
  } catch (error) {
    console.error(JSON.stringify({ error: /^[a-z0-9-]{1,80}$/.test(error?.message ?? '') ? error.message : 'cloud-probe-precondition-or-runtime-failure' }));
    process.exitCode = 1;
  }
}
