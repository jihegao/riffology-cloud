import type {CompilerIdentity} from './compiler-bundle.ts';

const SHA=/^[a-f0-9]{64}$/;
const KEYS=['bundleSha256','bundleId','businessFingerprint','planFingerprint','compilerVersion','runtimeVersion','domainPack','irVersions','executionProfile','resultSha256','stopReason'];
export type CompilerResult=CompilerIdentity&{resultSha256:string;stopReason:string};

function canonical(value:unknown):string{
  if(Array.isArray(value))return `[${value.map(canonical).join(',')}]`;
  if(value&&typeof value==='object')return `{${Object.entries(value).sort(([a],[b])=>a<b?-1:a>b?1:0).map(([key,item])=>`${JSON.stringify(key)}:${canonical(item)}`).join(',')}}`;
  if(value===null||typeof value==='string'||typeof value==='boolean'||typeof value==='number'&&Number.isFinite(value))return JSON.stringify(value);
  throw Error('simulation-result-invalid');
}

/** Native SDK identity must match the frozen Revision's preflight identity. */
export function checkedCompilerResult(raw:unknown,expected:CompilerIdentity):CompilerResult{
  if(!raw||typeof raw!=='object'||Array.isArray(raw)||Object.keys(raw).sort().join(',')!==KEYS.slice().sort().join(','))throw Error('simulation-result-invalid');
  const value=raw as Record<string,unknown>;
  if(typeof value.resultSha256!=='string'||!SHA.test(value.resultSha256)||typeof value.stopReason!=='string'||!/^[a-z][a-z0-9_-]{0,63}$/.test(value.stopReason))throw Error('simulation-result-invalid');
  const {resultSha256,stopReason,...identity}=value;
  if(canonical(identity)!==canonical(expected))throw Error('simulation-result-invalid');
  return {...expected,resultSha256,stopReason};
}
