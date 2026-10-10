import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import vm from 'node:vm';
import {cleanupOnceSource} from '../../services/entry/validation-cleanup-ui.ts';
import {entry} from '../../services/entry/index.ts';
import {validationCanonical as canonical,validationTransport as transport} from '../../services/entry/validation-policy.ts';
const create=vm.runInNewContext('('+cleanupOnceSource+')');
function fixture(send=async()=>{}){
  let elapsed=0,sends=0,disabled=0;const timers=[],reports=[];
  const trigger=create({serverNow:1000,expires:2000,monotonicNow:()=>elapsed,setTimer:(fn,delay)=>timers.push({fn,delay}),
    disable:()=>disabled++,report:t=>reports.push(t),send:async()=>{sends++;await send();}});
  return {trigger,timers,reports,advance:ms=>elapsed=ms,sends:()=>sends,disabled:()=>disabled};
}
test('manual early cleanup consumes no request; scheduled and manual triggers share one consumed flag',async()=>{
  const f=fixture();assert.equal(f.timers.length,1);assert.equal(f.timers[0].delay,1001);
  await f.trigger();assert.equal(f.sends(),0);assert.deepEqual(f.reports,['cleanup not due']);
  f.advance(1001);f.timers[0].fn();await f.trigger();await f.trigger();await Promise.resolve();
  assert.equal(f.sends(),1);assert.equal(f.disabled(),1);assert.equal(f.timers.length,1);
});
test('manual first and concurrent cleanup clicks cannot race the timer into another POST',async()=>{
  let done;const gate=new Promise(resolve=>done=resolve),f=fixture(()=>gate);f.advance(1001);
  const first=f.trigger();f.timers[0].fn();await f.trigger();assert.equal(f.sends(),1);done();await first;assert.equal(f.sends(),1);
});
for(const outcome of ['timeout','network-disconnected','receipt-lost'])test(`${outcome} keeps cleanup attempt consumed; no automatic or manual retry`,async()=>{
  const f=fixture(async()=>{throw Error(outcome);});f.advance(1001);
  await f.trigger();f.timers[0].fn();await f.trigger();assert.equal(f.sends(),1);
  assert.equal(f.reports.at(-1),'cleanup unknown; do not retry');assert.equal(f.timers.length,1);
});
test('sleep past cleanup interval produces pending with zero POST; abandoned page has no invented receipt',async()=>{
  const late=fixture();late.advance(31000);late.timers[0].fn();await late.trigger();assert.equal(late.sends(),0);
  assert.equal(late.reports.at(-1),'cleanup missed; pending, do not retry');
  const abandoned=fixture();assert.equal(abandoned.sends(),0);assert.equal(abandoned.reports.length,0);
});
test('actual A UI embeds one cleanup timer, bounded POST and matching CSP; B schedules no cleanup',async()=>{
  const now=Date.now(),run='offline_cleanup_ui_20261009',config={version:1,run,notBefore:now-1000,expires:now+299000,ips:{A:'198.51.100.23',B:'198.51.100.24'}};
  const env={APP_ORIGIN:canonical,APP_TRANSPORT_ORIGIN:transport,TWO_ACCOUNT_AUTH_MODE:'signed-entry-v1',RIFFOID_VALIDATION_CONFIG_JSON:JSON.stringify(config)};
  for(const slot of ['A','B']){
    const request=new Request(`${canonical}/__riffoid-validation/${run}/${slot}/ui`,{headers:{host:'app.riffoid.com','cf-connecting-ip':config.ips[slot]}});
    const response=await entry(request,env,async()=>{throw Error('fixture must not forward');}),html=await response.text();
    assert.equal(response.status,200);const script=html.match(/<script>([\s\S]*)<\/script>/)[1];
    const sha=createHash('sha256').update(script).digest('base64');assert.ok(response.headers.get('content-security-policy').includes(`'sha256-${sha}'`));
    assert.equal(script.includes('const cleanup=cleanupOnce('),slot==='A');
    if(slot==='A')assert.ok(script.includes('setTimeout(()=>controller.abort(),5000)'));
    assert.ok(script.includes("credentials:'omit'"));assert.ok(!/localStorage|sessionStorage|document\.cookie/.test(script));
    new vm.Script(script);
  }
});

for(const outcome of ['success','timeout','network-disconnected','receipt-lost'])test(`rendered original A page: ${outcome}, abort timer and duplicate triggers produce at most one cleanup fetch`,async()=>{
  const now=Date.now(),run='offline_cleanup_rendered_20261009',config={version:1,run,notBefore:now-1000,expires:now+299000,ips:{A:'198.51.100.23',B:'198.51.100.24'}};
  const response=await entry(new Request(`${canonical}/__riffoid-validation/${run}/A/ui`,{headers:{host:'app.riffoid.com','cf-connecting-ip':config.ips.A}}),
    {APP_ORIGIN:canonical,APP_TRANSPORT_ORIGIN:transport,TWO_ACCOUNT_AUTH_MODE:'signed-entry-v1',RIFFOID_VALIDATION_CONFIG_JSON:JSON.stringify(config)},async()=>{throw Error('no outbound UI');});
  const script=(await response.text()).match(/<script>([\s\S]*)<\/script>/)[1],nodes=Object.fromEntries(['observe','run','cleanup','result'].map(id=>[id,{disabled:false,textContent:''}]));
  let elapsed=0;const timers=[],calls=[];
  const context={document:{getElementById:id=>nodes[id]},performance:{now:()=>elapsed},AbortController,TextEncoder,
    setTimeout:(fn,delay)=>{const t={fn,delay,cleared:false};timers.push(t);return t;},clearTimeout:t=>t.cleared=true,
    fetch:async(url,options)=>{calls.push({url,options});
      if(outcome==='timeout')return await new Promise((_,reject)=>options.signal.addEventListener('abort',()=>reject(Error('timeout')),{once:true}));
      if(outcome!=='success')throw Error(outcome);
      return Response.json({slot:'A',case:'cleanup',passed:true,nativeIpMatches:true,results:[{case:'cleanup',status:200,code:'expired_control_rows_removed',removed:2}]});
    }};
  vm.runInNewContext(script,context);const scheduled=timers[0];elapsed=scheduled.delay;
  nodes.result.textContent='saved original Run receipt';scheduled.fn();nodes.cleanup.onclick();
  if(outcome==='timeout'){assert.equal(timers[1].delay,5000);timers[1].fn();}
  for(let i=0;i<8;i++)await Promise.resolve();nodes.cleanup.onclick();scheduled.fn();
  assert.equal(calls.length,1);assert.ok(calls[0].url.endsWith('/A/cleanup'));assert.equal(calls[0].options.credentials,'omit');
  assert.equal(calls[0].options.body,'');assert.equal(nodes.cleanup.disabled,true);
  assert.ok(nodes.result.textContent.startsWith('saved original Run receipt'));
  assert.ok(nodes.result.textContent.includes(outcome==='success'?'expired_control_rows_removed':'cleanup unknown; do not retry'));
});

test('unknown original Observe halts Run and scheduled cleanup with zero follow-up fetches',async()=>{
  const now=Date.now(),run='offline_unknown_halt_20261010',config={version:1,run,notBefore:now-1000,expires:now+299000,ips:{A:'198.51.100.23',B:'198.51.100.24'}};
  const response=await entry(new Request(`${canonical}/__riffoid-validation/${run}/A/ui`,{headers:{host:'app.riffoid.com','cf-connecting-ip':config.ips.A}}),{APP_ORIGIN:canonical,APP_TRANSPORT_ORIGIN:transport,TWO_ACCOUNT_AUTH_MODE:'signed-entry-v1',RIFFOID_VALIDATION_CONFIG_JSON:JSON.stringify(config)},async()=>{throw Error('no forwarding');});
  const script=(await response.text()).match(/<script>([\s\S]*)<\/script>/)[1],nodes=Object.fromEntries(['observe','run','cleanup','result'].map(id=>[id,{disabled:false,textContent:''}]));
  let elapsed=0;const timers=[],calls=[];
  vm.runInNewContext(script,{document:{getElementById:id=>nodes[id]},performance:{now:()=>elapsed},AbortController,TextEncoder,setTimeout:(fn,delay)=>{const t={fn,delay,cleared:false};timers.push(t);return t;},clearTimeout:t=>t.cleared=true,fetch:async url=>{calls.push(url);throw Error('lost original response');}});
  nodes.observe.onclick();for(let i=0;i<8;i++)await Promise.resolve();
  elapsed=timers[0].delay;timers[0].fn();nodes.run.onclick();nodes.cleanup.onclick();nodes.observe.onclick();for(let i=0;i<8;i++)await Promise.resolve();
  assert.equal(calls.length,1);assert.ok(calls[0].endsWith('/A/observe'));assert.equal(timers[0].cleared,true);for(const id of ['observe','run','cleanup'])assert.equal(nodes[id].disabled,true);assert.ok(nodes.result.textContent.includes('do not retry'));
});
