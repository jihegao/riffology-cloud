import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { benchmarkPlan, tasks } from './benchmark-plan.mjs';
import { conservativeCost, productionProfile } from '../../services/model-proxy/production-profile.ts';

export const fixtureSha256 = '673d0cbe930990602649aaa9d746e16ad29280981f5f7be336b368388ceee753';
const runs = [1, 2, 1, 1, 6, 2];
const seeds = [[104729,104759,104761],[130363,130367,130369],[155921,155927,155929]];
export function frozenSchedule() {
  return seeds.flatMap((pairedSeeds, repeat) => tasks.map((task, index) => ({
    fixtureId: `repeat-${repeat+1}/${task.id}`, repeat: repeat+1, projectSlot: repeat+1,
    category: task.id, dependsOn: index ? `repeat-${repeat+1}/${tasks[index-1].id}` : null,
    primarySeed: pairedSeeds[0], pairedSeeds: [...pairedSeeds], maxDispatches: 8,
    explicitRuns: runs[index],
  })));
}
const integer = (value, label) => {
  if (!Number.isSafeInteger(value) || value < 0) throw Error(`invalid-${label}`);
  return value;
};
/** Compiles a proposal; hashes/reference strings never establish authorization. */
export async function compileSchedule(input) {
  const manifest = input.productionManifest;
  const plan = await benchmarkPlan(manifest);
  if (manifest.maxCallsPerTask !== 8 || manifest.concurrency !== 1) throw Error('frozen-call-or-concurrency-bound');
  if (manifest.taskFixturesSha256 !== fixtureSha256) throw Error('frozen-fixture-mismatch');
  // Each of the three group intents is an admission task in the frozen scope.
  const groupIntentTasks = integer(input.groupIntentTasks, 'group-intent-tasks');
  if (groupIntentTasks !== 3) throw Error('group-intent-classification-required');
  const extraTurns = integer(input.extraTurns, 'extra-turns');
  if (extraTurns !== 0) throw Error('extra-turns-require-revised-frozen-plan');
  // 3 Projects + 18 Turns + 39 child Runs + 3 group intents = 63 normal admissions.
  const normalAdmissionTasks = 3 + 18 + 39 + groupIntentTasks;
  const taskCap = integer(input.taskCap, 'task-cap');
  // The first rollover retained one optional probe Task. A chained rollover
  // with exactly 63 Tasks runs only the frozen normal suite.
  const probeTasks = taskCap === normalAdmissionTasks + 1 ? 1 : taskCap === normalAdmissionTasks ? 0 : -1;
  if (probeTasks < 0) throw Error('task-cap-conflict');
  const maximumAdmissionTasks = normalAdmissionTasks + probeTasks;
  const allowedDispatchCaps = probeTasks === 1 ? [146] : [144, 145];
  if (!allowedDispatchCaps.includes(input.dispatchCap) || input.runCap !== 39) throw Error('frozen-dispatch-or-run-cap');
  const profile = productionProfile(manifest.profile);
  const perCall = BigInt(conservativeCost(profile, profile.limits.maxInputTokens, profile.limits.maxOutputTokens));
  const total = perCall * BigInt(input.dispatchCap);
  if (total > BigInt(manifest.globalCapNanodollars)) throw Error('probe-inclusive-budget-too-small');
  if (total > BigInt(Number.MAX_SAFE_INTEGER)) throw Error('unsafe-budget-total');
  return { schemaVersion: 1, kind: 'offline-schedule-not-authorization', fixtureSha256,
    profileSha256: plan.profileSha256, schedule: frozenSchedule(), probes: [
      'missing-usage', 'transport-uncertain', 'single-upstream-attempt',
    ].slice(0,probeTasks).map((id,index) => ({ id, order: 19+index, maxDispatches: 1, requiresNormalSuiteTerminal: true })),
    limits: { projects:3, turns:18, explicitRuns:39, groupIntentTasks, extraTurns,
      normalAdmissionTasks, probeTasks, maximumAdmissionTasks, taskCap,
      normalDispatches:144, totalDispatches:144+probeTasks, dispatchCap:input.dispatchCap, maximumNanodollars:Number(total),
      maxTurnNanodollars:Number(perCall*8n) },
    stopOn: plan.stopOn, probePolicy: 'after-normal-suite; first-unknown-stops-all-new-admission',
  };
}
/** Pure terminal admission decision. Unknown costs are never released here. */
export function nextAdmission(compiled, completed) {
  if (!Array.isArray(completed)) throw Error('invalid-terminal-history');
  const sequence = [...compiled.schedule.map(t => ({id:t.fixtureId,maxDispatches:8})),
    ...compiled.probes.map(p => ({id:p.id,maxDispatches:1}))];
  if (completed.length > sequence.length) throw Error('too-many-terminal-records');
  for (let index=0; index<completed.length; index++) {
    const receipt = completed[index], expected = sequence[index];
    if (receipt.id !== expected.id) throw Error('terminal-order-mismatch');
    if (integer(receipt.dispatches,'dispatch-count') > expected.maxDispatches) throw Error('dispatch-bound-exceeded');
    if (!['accepted','failed','cancelled','unknown'].includes(receipt.status)) throw Error('invalid-terminal-status');
    if (receipt.status === 'unknown' || receipt.stopReason) {
      if (index !== completed.length-1) throw Error('admission-after-stop');
      return {state:'stopped',reason:receipt.stopReason || 'unknown-charge',preserveReservation:true};
    }
    if (receipt.status !== 'accepted') {
      if (index !== completed.length-1) throw Error('admission-after-unqualified-terminal');
      return {state:'blocked',reason:'unqualified-predecessor',fixtureId:receipt.id,preserveFailure:true};
    }
  }
  return completed.length === sequence.length ? {state:'complete'} : {state:'proposal-only',next:sequence[completed.length].id};
}
export function rejectExecute() { throw Error('execute-disabled: no approved live driver; manifest references are not authorization'); }
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    if (process.argv.includes('--execute')) rejectExecute();
    if (process.argv.length !== 3) throw Error('usage: node scripts/model/g5-benchmark-schedule.mjs proposal.json (offline only)');
    process.stdout.write(JSON.stringify(await compileSchedule(JSON.parse(await readFile(process.argv[2],'utf8'))),null,2)+'\n');
  } catch (error) { process.stderr.write(`${error.message}\n`); process.exitCode=1; }
}
