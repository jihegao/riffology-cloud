/** A response deadline does not cancel an SDK RPC. The owner keeps `actual`
 * until it settles, including a rejection after the caller has timed out. */
export class EffectDeadlineError extends Error {
  constructor() { super('effect-outcome-unknown'); }
}

export async function waitForEffect<T>(actual: Promise<T>, milliseconds: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([actual, new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new EffectDeadlineError()), Math.max(1, milliseconds));
    })]);
  } finally { clearTimeout(timer); }
}

export type EffectIntent = {
  sequence: number; generation: number; runtimeGeneration: number;
  operation: string; startedAt: number; outcome: 'pending' | 'unknown';
};
