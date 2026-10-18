import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const exec = promisify(execFile);
export const packageRoot = fileURLToPath(new URL('../', import.meta.url));
export const VERSION = '0.3.1';

export async function compilerConfig() {
  const saved = await readFile(new URL('../.compiler/config.json', import.meta.url), 'utf8').then(JSON.parse).catch(() => ({}));
  return {
    ...saved,
    python: process.env.RIFFOID_IR_PYTHON || saved.python || 'python3',
    pythonPath: process.env.RIFFOID_IR_COMPILER_PATH || saved.pythonPath,
    wheelSha256: process.env.RIFFOID_IR_COMPILER_WHEEL_SHA256 || saved.wheelSha256,
    packageSha256: process.env.RIFFOID_IR_PACKAGE_SHA256,
    mode: process.env.RIFFOID_IR_COMPILER_MODE || saved.mode || 'installed-sdk',
  };
}

export async function invokeCompiler(action, source = '-', output, signal) {
  const config = await compilerConfig();
  try {
    const { stdout } = await exec(config.python, [fileURLToPath(new URL('../scripts/compiler.py', import.meta.url)), action, source, ...output ? [output] : []], {
      env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1', ...config.pythonPath ? { PYTHONPATH: config.pythonPath } : {} },
      timeout: 30_000, maxBuffer: 8 * 1024 * 1024, signal,
    });
    return JSON.parse(stdout);
  } catch (error) {
    if (error.stdout) {
      try { return JSON.parse(error.stdout); } catch { /* process failed without SDK JSON */ }
    }
    return { status: 'failed', diagnostics: [{ code: signal?.aborted ? 'interrupted' : 'compiler_unavailable', stage: action,
      path: source, message: `${error.message}. Configure Python >=3.12 with sim-engine-compiler==0.1.0; see README.` }] };
  }
}
