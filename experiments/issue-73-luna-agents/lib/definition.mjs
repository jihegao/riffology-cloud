import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  ARTIFACT_PATHS,
  CONDITIONS,
  DEFAULT_REPETITIONS,
  EXPERIMENT_ID,
  EXPERIMENT_ROOT,
  FIXTURE_VERSION,
  HOSTED_PACKAGES,
  MODEL,
  REASONING_EFFORT,
  SDK_VERSION,
  SKILL_DESCRIPTION,
  SKILL_DIRECTORY,
  SKILL_NAME,
  TURNS_PER_SESSION,
} from './constants.mjs';
import { buildSkillArchive } from './archive.mjs';
import { canonicalJson, sha256 } from './util.mjs';

async function readPrompt(name) {
  return readFile(join(EXPERIMENT_ROOT, 'prompts', name), 'utf8');
}

export async function loadDefinition(repetitions = DEFAULT_REPETITIONS) {
  if (!Number.isSafeInteger(repetitions) || repetitions < 2 || repetitions > 10) {
    throw new Error('repetitions-must-be-between-2-and-10');
  }
  const [turn1, turn2, turn3, artifactContract, skill] = await Promise.all([
    readPrompt('turn-1.md'),
    readPrompt('turn-2.md'),
    readPrompt('turn-3.md'),
    readPrompt('artifact-contract.md'),
    buildSkillArchive(SKILL_DIRECTORY),
  ]);
  const prompts = [turn1, turn2, turn3].map(
    (prompt) => `${prompt.trim()}\n\n${artifactContract.trim()}\n`,
  );
  const definition = {
    experimentId: EXPERIMENT_ID,
    fixtureVersion: FIXTURE_VERSION,
    provider: 'openai',
    api: 'agents-v1',
    model: MODEL,
    reasoningEffort: REASONING_EFFORT,
    sdkVersion: SDK_VERSION,
    conditions: [...CONDITIONS],
    repetitionsPerCondition: repetitions,
    turnsPerSession: TURNS_PER_SESSION,
    hostedPackages: HOSTED_PACKAGES,
    networkAccess: 'disabled',
    multiAgent: false,
    mcp: false,
    prompts: prompts.map((text, index) => ({
      turn: index + 1,
      sha256: sha256(text),
      text,
      requiredArtifacts: [ARTIFACT_PATHS.manifest(index + 1), ARTIFACT_PATHS.project(index + 1)],
    })),
    skill: {
      name: SKILL_NAME,
      description: SKILL_DESCRIPTION,
      sha256: skill.sha256,
      files: skill.files,
    },
  };
  const runs = [];
  for (let repetition = 1; repetition <= repetitions; repetition += 1) {
    const order = repetition % 2 === 0 ? [...CONDITIONS].reverse() : [...CONDITIONS];
    for (const condition of order) {
      runs.push({
        id: `r${String(repetition).padStart(2, '0')}-${condition}`,
        repetition,
        condition,
        skillEnabled: condition === 'simulation-skill',
      });
    }
  }
  return {
    ...definition,
    definitionSha256: sha256(canonicalJson(definition)),
    runs,
    skillArchive: skill,
  };
}

export function publicDefinition(definition) {
  const { skillArchive: _archive, ...publicValue } = definition;
  return publicValue;
}
