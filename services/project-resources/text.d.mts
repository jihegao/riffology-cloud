export interface ProjectResourceScope {tenantId:string;projectId:string}
export interface ProjectResourceDiagnostic {path:string;code:string;sha256:string}
export interface ProjectResources {schema:'project.resources/v1';scope:ProjectResourceScope;revisionId:string|null;filesSha256:string;resources:Array<{path:string;kind:'agents'|'skill'|'prompt';content:string;sha256:string}>;sha256:string;diagnostics?:ProjectResourceDiagnostic[]}
export declare const RESOURCE_LIMITS:Readonly<{files:number;fileBytes:number;totalBytes:number}>;
export declare function resourceKind(path:string):'agents'|'skill'|'prompt'|null;
export declare function resourceText(path:string,content:string):{kind:'agents'|'skill'|'prompt';path:string;name:string;description:string;manualOnly:boolean;body:string};
export declare function freezeProjectResources(input:{scope:ProjectResourceScope;revisionId:string|null;filesSha256:string;files:Array<{path:string;content:string}>;diagnostics?:ProjectResourceDiagnostic[]}):ProjectResources;
export declare function validateProjectResources(raw:unknown,scope:ProjectResourceScope):ProjectResources;
export type ResourceProvenance=Omit<ProjectResources,'resources'>&{resources:Array<Omit<ProjectResources['resources'][number],'content'>&{loaded:boolean;loadedFromHistory?:boolean}>};
export declare function validateResourceProvenance(raw:unknown,scope:ProjectResourceScope):ResourceProvenance|null;
