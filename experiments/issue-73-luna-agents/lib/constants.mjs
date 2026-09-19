import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const EXPERIMENT_ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
export const REPOSITORY_ROOT = dirname(dirname(EXPERIMENT_ROOT));
export const EXPERIMENT_ID = 'issue-73-luna-agents';
export const FIXTURE_VERSION = 'schelling-v1';
export const MODEL = 'gpt-5.6-luna';
export const REASONING_EFFORT = 'low';
export const SDK_VERSION = '7.17.0';
export const CONDITIONS = Object.freeze(['baseline', 'simulation-skill']);
export const TURNS_PER_SESSION = 3;
export const DEFAULT_REPETITIONS = 3;
export const SKILL_NAME = 'riffology-simulation';
export const SKILL_DESCRIPTION =
  'Design, implement, execute, and evaluate complex-system simulations when results must be reproducible and traceable to real runs.';
export const SKILL_DIRECTORY = join(EXPERIMENT_ROOT, 'skills', SKILL_NAME);
export const ARTIFACT_PATHS = Object.freeze({
  manifest: (turn) => `/workspace/outputs/turn-${turn}-manifest.json`,
  project: (turn) => `/workspace/outputs/turn-${turn}-project.zip`,
});
export const HOSTED_PACKAGES = Object.freeze({
  python: [
    'mesa==3.5.1',
    'numpy==2.3.3',
    'pandas==2.3.2',
    'matplotlib==3.10.6',
    'networkx==3.5',
  ],
});
export const RATE_CARD = Object.freeze({
  source: 'https://developers.openai.com/api/docs/pricing',
  inputUsdPerMillion: 0.2,
  cachedInputUsdPerMillion: 0.02,
  outputUsdPerMillion: 1.2,
  sandbox1GbUsdPer20Minutes: 0.03,
  minimumSandboxMinutes: 5,
});
