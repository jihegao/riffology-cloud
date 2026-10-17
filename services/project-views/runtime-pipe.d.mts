import type {ProjectViewRuntimeStart} from './runtime-protocol.ts';
import type {ProjectViewNativeSession} from './runtime-core.ts';
export const PROJECT_VIEW_BROWSER_PROGRAM:string;
export interface ProjectViewRuntimePipe extends ProjectViewNativeSession{
 ready:Promise<void>;
 capture():Promise<void>;
}
export function createProjectViewRuntimePipe(process:Pick<ExecProcess,'stdin'|'stdout'|'exitCode'|'kill'>,input:ProjectViewRuntimeStart):ProjectViewRuntimePipe;
