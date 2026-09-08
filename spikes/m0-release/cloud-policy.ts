export const RELEASE_RUN = 'release-g0-v3-20260906';
export const RELEASE_ORIGIN = 'https://riffology-m0-release-staging.jihe-gao.workers.dev';
export const IMAGE_V1 = 'docker.io/jihegao/riffology-m0-trusted-proxy@sha256:4be14ca3e2191e2a2941d4eb0ff7ac904c5a694b60ee839f75ac429eac7f3e67';
export const IMAGE_V2 = 'docker.io/jihegao/riffology-m0-project@sha256:c010768e37d6ad06da137308d30faf32b9ec7fcc21916f29f146c281c7a6946e';
export const PHASES = ['baseline', 'compatibility', 'hold', 'upgrade', 'startup-failure', 'rollback'] as const;
export type ReleasePhase = typeof PHASES[number];
export type WorkerRelease = 'w1' | 'w2';
export type CounterReport = {protocol:string;format:number;command:string;requestId:string;counter:number;pid:number;status:string;active:unknown;[key:string]:unknown};
export function admitCounter(value:unknown):asserts value is CounterReport {
 if (!value || typeof value !== 'object') throw Error('runtime-response');
 const v=value as CounterReport;
 if(v.protocol!=='m0-v1'||v.format!==1||!Number.isSafeInteger(v.counter)||v.counter<0||!Number.isSafeInteger(v.pid)||v.pid<1)throw Error('runtime-incompatible');
}
export function requirePhaseRelease(phase:ReleasePhase,release:WorkerRelease){
 if(release!==(['baseline','rollback'].includes(phase)?'w1':'w2'))throw Error('worker-release-mismatch');
}
