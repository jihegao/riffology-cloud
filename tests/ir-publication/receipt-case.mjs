/** Actual demand consumer against a synthetic filesystem/browser response. */
import assert from 'node:assert/strict';
import {mock} from 'node:test';
const requestId='560ada22-f507-48b9-b926-8df6d6b90ceb';
const directory='/private/tmp/riffoid-ir-quiescence-demands-20261019-560ada22';
const stream={directory:'/Users/jihegao/Downloads',prefix:'riffoid-ir-quiescence-demand-560ada22-',demandDirectory:directory};
const policy='a'.repeat(64),hold={requestId,policySha256:policy,controlRevision:19,beganAt:1};
const control={revision:19,policySha256:policy,pinnedPolicySha256:policy,enabled:true,paused:false};
const facts={requestId,publicOrigin:'https://offline-fixture.invalid',endsAt:new Date(Date.now()+60000).toISOString(),newIrMaintenance:{hold,control}};
const files=new Map();let fault=null,demands=0;
const missing=()=>Object.assign(new Error('synthetic missing file'),{code:'ENOENT'});
function browserResponse(demand){
  if(fault==='timeout')return;
  const ledger={scope:'original-beta-ledger-only',quiescent:true,activeSlots:0,quarantinedSlots:0,unresolvedCalls:0};
  const body={schemaVersion:1,requestId,revision:5,checkedAt:Date.now(),quiescent:true,actualContainerReleaseVerified:false,
    hold:structuredClone(hold),control:structuredClone(control),ledger:structuredClone(ledger),ledgerBefore:structuredClone(ledger),
    native:{actor:'trusted-pi-capacity:application',policyVersion:'synthetic',quiescent:true,coldUnresolved:0,pairUnresolved:0,actualContainerReleaseVerified:false}};
  const response={schema:'riffoid-ir.operator-browser-response/v1',observedAt:Date.now(),method:'GET',path:'/api/admin/private-beta/maintenance/quiescence',requestId,httpStatus:200,body,demandNonce:demand.demandNonce};
  if(fault==='stale')response.observedAt-=40000;
  if(fault==='nonce')response.demandNonce='0'.repeat(32);
  if(fault==='active')body.ledger.activeSlots=1;
  if(fault==='hold')body.hold.controlRevision=20;
  files.set(stream.directory+'/'+demand.targetFile,Buffer.from(JSON.stringify(response)));
}
mock.module('node:fs/promises',{namedExports:{
  async mkdir(){},async realpath(path){return path;},
  async lstat(){return {isDirectory:()=>true,isSymbolicLink:()=>false,uid:process.getuid(),mode:0o700};},
  async open(path,flags){
    if(flags==='wx'){
      if(files.has(path))throw Object.assign(Error('exists'),{code:'EEXIST'});
      files.set(path,Buffer.alloc(0));demands++;
      return {async writeFile(bytes){files.set(path,Buffer.from(bytes));},async sync(){browserResponse(JSON.parse(files.get(path)));},async close(){}};
    }
    if(path===directory)return {async sync(){},async close(){}};
    if(!files.has(path))throw missing();
    return {async readFile(){return Buffer.from(files.get(path));},async close(){},async stat(){return {
      isFile:()=>true,uid:BigInt(process.getuid()),nlink:1n,size:BigInt(files.get(path).length),dev:1n,ino:1n,mtimeNs:1n,ctimeNs:1n,
    };}};
  }
}});
const {demandFreshQuiescence,recheckExactQuiescence}=await import('../../scripts/ir-publication/receipt-on-demand.mjs');
const options=()=>({stream,facts,phase:'before-worker-put',deadline:Date.now()+1000});
const first=await demandFreshQuiescence(options());assert.equal(demands,1);
await recheckExactQuiescence(first,options());assert.equal(demands,1,'rechecking exact bytes creates no new demand');
files.set(first.reference.file,Buffer.from('{}'));
await assert.rejects(recheckExactQuiescence(first,options()),e=>e.code==='pinned-evidence-drift');
for(const kind of ['stale','nonce','active','hold','timeout']){
  fault=kind;const before=demands;
  await assert.rejects(demandFreshQuiescence({...options(),deadline:Date.now()+(kind==='timeout'?20:1000)}));
  assert.equal(demands,before+1,'one demand, no retry/download loop');
}
const before=demands,c=new AbortController();c.abort();
await assert.rejects(demandFreshQuiescence({...options(),signal:c.signal}));assert.equal(demands,before);
console.log(JSON.stringify({passed:true,cases:8,demands,filesystem:'synthetic only',networkRequests:0}));
