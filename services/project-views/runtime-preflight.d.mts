export const PROJECT_VIEW_PREFLIGHT_PROGRAM:string;
export type ProjectViewPreflightReport={schema:'project-view-preflight/v1';contextReceiptSha256:string;files:176;bytes:number;uid:10001;gid:10001;chromium:'153.0.8010.12'};
export function projectViewPreflightMain(options?:Record<string,unknown>):Promise<ProjectViewPreflightReport>;
export function readProjectViewPreflight(process:Pick<ExecProcess,'stdout'|'exitCode'>,expectedReceiptSha256:string):Promise<ProjectViewPreflightReport>;
