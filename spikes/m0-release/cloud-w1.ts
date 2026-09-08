import { ReleaseCoordinator, fetchRelease } from './cloud-host.ts';
export { ReleaseSandbox } from './cloud-host.ts';
export class ReleaseHost extends ReleaseCoordinator { override readonly workerRelease='w1' as const; }
export default {fetch:fetchRelease};
