import test from 'node:test';
import assert from 'node:assert/strict';
import {g5TerminalGroupAuthority} from '../../services/simulation/groups.ts';

const run=(runId:string,overrides:Record<string,unknown>={})=>({runId,status:'completed',released:true,releaseProof:{kind:'runtime-stopped',confirmationId:'proof-'+runId,observedAt:1},...overrides});
const group=(children:string[],overrides:Record<string,unknown>={})=>({groupId:'group-one',status:'completed',children:children.map(runId=>({runId,configurationId:'baseline',seed:1,cancelled:false})),...overrides});

test('group final authority requires terminal released children and completed group',()=>{assert.deepEqual(g5TerminalGroupAuthority([run('run-two'),run('run-one')] as never,[group(['run-one','run-two'])] as never),{runIds:['run-one','run-two'],groupIds:['group-one']});for(const invalid of [[run('run-one',{released:false})],[run('run-one',{releaseProof:null})],[run('run-one',{status:'running'})]])assert.throws(()=>g5TerminalGroupAuthority(invalid as never,[group(['run-one'])] as never),/simulation-authority-conflict/);assert.throws(()=>g5TerminalGroupAuthority([run('run-one')] as never,[group(['run-one'],{status:'running'})] as never),/group-authority-incomplete/);assert.throws(()=>g5TerminalGroupAuthority([run('run-one')] as never,[group(['run-two'])] as never),/group-authority-incomplete/);});
