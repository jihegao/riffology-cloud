import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import vm from 'node:vm';
import {cleanupOnceSource} from '../../services/entry/validation-cleanup-ui.ts';
import {entry} from '../../services/entry/index.ts';
import {validationCanonical as canonical,validationTransport as transport} from '../../services/entry/validation-policy.ts';
const create=vm.runInNewContext('('+cleanupOnceSource+')');
function fixture(send=async()=>{},canArm=()=>true){
  let elapsed=0,sends=0;const timers=[],reports=[];
  const trigger=create({serverNow:1000,expires:2000,monotonicNow:()=>elapsed,canArm,enable:()=>{},setTimer:(fn,delay)=>{const t={fn,delay,cleared:false};timers.push(t);return t;},clearTimer:t=>t.cleared=true,
    disable:()=>{},report:t=>reports.push(t),send:async()=>{sends++;await send();}});
  return {trigger,timers,reports,advance:ms=>elapsed=ms,sends:()=>sends};
}
test('cleanup is unarmed with no timer or request until one local authorization',async()=>{
  const f=fixture();assert.equal(f.timers.length,0);f.advance(1001);await f.trigger();assert.equal(f.sends(),0);
  assert.equal(f.trigger.arm(),true);assert.equal(f.trigger.arm(),false);assert.equal(f.timers.length,1);
  await f.trigger();f.timers[0].fn();await f.trigger();assert.equal(f.sends(),1);
});
test('missing coordinator confirmation or permanent Stop cannot arm cleanup',async()=>{
  const f=fixture(async()=>{},()=>false);assert.equal(f.trigger.arm(),false);assert.equal(f.timers.length,0);
  const stopped=fixture();stopped.trigger.halt();assert.equal(stopped.trigger.arm(),false);await stopped.trigger();assert.equal(stopped.sends(),0);
});
test('early click is unspent; timer and concurrent clicks consume only one request',async()=>{
  let done;const gate=new Promise(resolve=>done=resolve),f=fixture(()=>gate);f.trigger.arm();await f.trigger();assert.equal(f.sends(),0);
  f.advance(1001);const first=f.trigger();f.timers[0].fn();await f.trigger();assert.equal(f.sends(),1);done();await first;
});
for(const outcome of ['timeout','network-disconnected','receipt-lost'])test(`${outcome}: armed cleanup is never retried`,async()=>{
  const f=fixture(async()=>{throw Error(outcome);});f.trigger.arm();f.advance(1001);await f.trigger();f.timers[0].fn();await f.trigger();assert.equal(f.sends(),1);assert.equal(f.reports.at(-1),'cleanup unknown; do not retry');
});
test('missed interval and abandoned unarmed page produce zero POST',async()=>{
  const f=fixture();f.trigger.arm();f.advance(31000);f.timers[0].fn();await f.trigger();assert.equal(f.sends(),0);assert.equal(f.reports.at(-1),'cleanup missed; pending, do not retry');assert.equal(fixture().timers.length,0);
});
async function rendered(slot='A',send=async()=>Response.json({passed:true}),confirm=()=>true){
  const now=Date.now(),run='offline_cleanup_rendered_20261010',config={version:1,run,notBefore:now-1000,expires:now+299000,ips:{A:'198.51.100.23',B:'198.51.100.24'}};
  const response=await entry(new Request(`${canonical}/__riffoid-validation/${run}/${slot}/ui`,{headers:{host:'app.riffoid.com','cf-connecting-ip':config.ips[slot]}}),{APP_ORIGIN:canonical,APP_TRANSPORT_ORIGIN:transport,TWO_ACCOUNT_AUTH_MODE:'signed-entry-v1',RIFFOID_VALIDATION_CONFIG_JSON:JSON.stringify(config)},async()=>{throw Error('no UI forwarding');});
  const html=await response.text(),script=html.match(/<script>([\s\S]*)<\/script>/)[1];
  assert.ok(response.headers.get('content-security-policy').includes(`'sha256-${createHash('sha256').update(script).digest('base64')}'`));
  const nodes=Object.fromEntries(['observe','run','cleanup','armCleanup','stop','result'].map(id=>[id,{disabled:['cleanup','armCleanup'].includes(id),textContent:''}]));let elapsed=0;const timers=[],calls=[];
  vm.runInNewContext(script,{document:{getElementById:id=>nodes[id]},performance:{now:()=>elapsed},AbortController,TextEncoder,confirm,setTimeout:(fn,delay)=>{const t={fn,delay,cleared:false};timers.push(t);return t;},clearTimeout:t=>t.cleared=true,fetch:async(url,options)=>{calls.push({url,options});return send(url,options);}});
  return {nodes,timers,calls,script,html,advance:ms=>elapsed=ms};
}
test('both UI pages expose local Stop; A starts unarmed and B has no cleanup scheduler',async()=>{
  for(const slot of ['A','B']){const f=await rendered(slot);assert.equal(f.timers.length,0);assert.equal(f.script.includes('const cleanup=cleanupOnce('),slot==='A');assert.ok(!/localStorage|sessionStorage|document\.cookie|setInterval/.test(f.script));assert.ok(f.html.includes('Stop this original page locally'));}
});
for(const outcome of ['success','timeout','network-disconnected','receipt-lost'])test(`rendered A ${outcome}: successful own Run + external confirmation + one arm uses at most one cleanup`,async()=>{
  const f=await rendered('A',async(url,options)=>{
    if(url.endsWith('/run'))return Response.json({passed:true});
    if(outcome==='timeout')return new Promise((_,reject)=>options.signal.addEventListener('abort',()=>reject(Error('timeout')),{once:true}));
    if(outcome!=='success')throw Error(outcome);
    return Response.json({passed:true,code:'expired_control_rows_removed'});
  });
  f.nodes.armCleanup.onclick();assert.equal(f.timers.length,0);await f.nodes.run.onclick();assert.equal(f.nodes.armCleanup.disabled,false);f.nodes.armCleanup.onclick();const timer=f.timers.find(t=>t.delay>100000&&!t.cleared);assert.ok(timer);
  f.advance(timer.delay);timer.fn();f.nodes.cleanup.onclick();if(outcome==='timeout')f.timers.find(t=>t.delay===5000&&!t.cleared).fn();
  for(let i=0;i<20;i++)await Promise.resolve();f.nodes.cleanup.onclick();timer.fn();
  assert.equal(f.calls.filter(c=>c.url.endsWith('/cleanup')).length,1);assert.equal(f.calls.length,2);assert.equal(f.nodes.cleanup.disabled,true);assert.ok(f.nodes.result.textContent.includes('"operation":"run"'));assert.equal(f.calls[1].options.credentials,'omit');
});
test('B unknown leaves A cleanup unarmed; operator cannot authorize without both receipts and can Stop A',async()=>{
  let confirmed=false;const a=await rendered('A',async()=>Response.json({passed:true}),()=>confirmed);const b=await rendered('B',async()=>{throw Error('B original unknown');});
  await a.nodes.run.onclick();await b.nodes.run.onclick();a.nodes.armCleanup.onclick();a.advance(300001);a.nodes.cleanup.onclick();assert.equal(a.calls.length,1);assert.equal(a.timers.filter(t=>!t.cleared).length,0);
  a.nodes.stop.onclick();confirmed=true;a.nodes.armCleanup.onclick();a.nodes.run.onclick();a.nodes.observe.onclick();a.nodes.cleanup.onclick();assert.equal(a.calls.length,1);assert.equal(b.calls.length,1);assert.equal(a.nodes.armCleanup.disabled,true);
});
test('manual Stop aborts an in-flight original Run without follow-up RPC or clearing unknown',async()=>{
  const f=await rendered('A',async(_url,options)=>new Promise((_,reject)=>options.signal.addEventListener('abort',()=>reject(Error('stopped')),{once:true})));
  const pending=f.nodes.run.onclick();f.nodes.stop.onclick();await pending;f.advance(300001);f.nodes.cleanup.onclick();f.nodes.armCleanup.onclick();assert.equal(f.calls.length,1);assert.equal(f.calls[0].options.signal.aborted,true);assert.ok(f.timers.every(t=>t.cleared));assert.ok(f.nodes.result.textContent.includes('"outcome":"unknown"'));
});
test('Stop cancels an armed cleanup timer; even invoking its old callback produces no request',async()=>{
  const f=await rendered();await f.nodes.run.onclick();f.nodes.armCleanup.onclick();const t=f.timers.find(t=>!t.cleared);f.nodes.stop.onclick();f.advance(t.delay);t.fn();f.nodes.cleanup.onclick();assert.equal(f.calls.length,1);assert.equal(t.cleared,true);
});
