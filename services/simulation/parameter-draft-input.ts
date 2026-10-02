import type {ParameterValues} from './model-spec.ts';
export function parameterDraftArguments(raw:unknown){
 if(!raw||typeof raw!=='object'||Array.isArray(raw)||Object.keys(raw).sort().join(',')!=='comparison,parameters,revisionId,seed'||JSON.stringify(raw).length>32768)throw Error('invalid-tool-arguments');
 const r=raw as {revisionId:string|null;parameters:ParameterValues;seed:number;comparison:unknown};
 if(r.revisionId!==null&&(typeof r.revisionId!=='string'||!/^[A-Za-z0-9_-]{1,128}$/.test(r.revisionId))||!Number.isSafeInteger(r.seed)||r.seed<0||r.seed>4294967295||!r.parameters||typeof r.parameters!=='object'||Array.isArray(r.parameters))throw Error('invalid-tool-arguments');
 return structuredClone(r);
}
