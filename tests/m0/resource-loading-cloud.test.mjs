import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runResourceLoadingProbe } from '../../services/runtime/resource-loading-probe.mjs';
import { checkReport, RUN } from '../../scripts/m0/resource-loading-cloud.mjs';
test('cloud verifier requires actual detailed controls and cleanup, not only top-level passed',async()=>{
 const directory=await realpath(await mkdtemp(join(tmpdir(),'m0-cloud-report-')));
 try{
  const report=await runResourceLoadingProbe({trustedCwd:directory});
  const value={environment:'cloudflare-vm',realProviderCalls:0,sandboxId:`m0-ph-${RUN}-s`,state:{runId:RUN,phase:'completed',closed:true,operation:null,cleanup:'confirmed',error:null,report}};
  checkReport(value);
  for(const mutate of [x=>x.state.report.phases[1].extensionMarkerAbsent=false,x=>x.state.report.positiveControls.maliciousToolRegistered=false,x=>x.state.cleanup='unconfirmed',x=>x.state.operation='destroy',x=>x.state.report.requests=3]){const changed=structuredClone(value);mutate(changed);assert.throws(()=>checkReport(changed));}
 }finally{await rm(directory,{recursive:true,force:true});}
});
