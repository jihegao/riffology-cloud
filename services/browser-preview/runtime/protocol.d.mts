export type RuntimeInput = {parameters: Record<string, number | string | boolean>; seed: number};
export type RuntimeSnapshot = {schemaVersion: 'riffology.visual/v0.1'; frame: number; time: number; space: {type:'grid'; width:number; height:number} | {type:'lane'; lanes:string[]}; agents: Array<Record<string, unknown>>; metrics: Record<string, number>};
export type RuntimeTrace = {model: string; snapshots: RuntimeSnapshot[]};
export const LIMITS: Readonly<{inputBytes:number; resultBytes:number; frames:number; agentsPerFrame:number; gridCells:number; deadlineMs:number; maxSteps:number; cacheBytes:number; sourceBytes:number; bundleBytes:number}>;
export function validateInput(input: unknown): RuntimeInput;
export function validateTrace(trace: unknown): RuntimeTrace;
