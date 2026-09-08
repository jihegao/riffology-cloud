import { ReleaseCoordinator, fetchRelease } from './cloud-host.ts';
export { ReleaseSandbox } from './cloud-host.ts';
export class ReleaseHost extends ReleaseCoordinator { override readonly workerRelease='w2' as const; }
export default {fetch:fetchRelease};
