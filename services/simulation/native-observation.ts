/** Facts from the root native envelope, never from generated result.metrics. */
export function checkedNativeObservation(raw:unknown,runId:string,filesSha256:string,token?:string,confirmationId?:string){
 const invalid=()=>{throw Error('simulation-native-observation-invalid');};
 const object=(v:unknown,keys:string[]):Record<string,unknown>=>{if(!v||typeof v!=='object'||Array.isArray(v)||Object.keys(v).sort().join(',')!==keys.sort().join(','))invalid();return v as Record<string,unknown>;};
 const integer=(v:unknown)=>Number.isSafeInteger(v)&&Number(v)>=0;
 if(new TextEncoder().encode(JSON.stringify(raw)).byteLength>4096)invalid();
 const v=object(raw,['schemaVersion','runId','token','filesSha256','child','stop','sealed','quiescent']);
 if(v.schemaVersion!==1||v.runId!==runId||v.filesSha256!==filesSha256||typeof v.token!=='string'||!/^[a-f0-9]{52}$/.test(v.token)||(token!==undefined&&v.token!==token)||v.sealed!==true||v.quiescent!==true)invalid();
 const stop=object(v.stop,['confirmationId','observedAt','fenced']);
 if(typeof stop.confirmationId!=='string'||!/^[a-f0-9]{64}$/.test(stop.confirmationId)||!integer(stop.observedAt)||(confirmationId!==undefined&&stop.confirmationId!==confirmationId)||stop.fenced!==true)invalid();
 if(v.child===null)invalid();
 {
  const c=object(v.child,['pid','startTicks','uid','gid','noNewPrivileges','rlimitAS','rlimitNPROC','network','pidfd']);
  if(!integer(c.pid)||Number(c.pid)<1||!integer(c.startTicks)||c.noNewPrivileges!==1||!['opened','unsupported','unobserved'].includes(String(c.pidfd)))invalid();
  for(const k of ['uid','gid'])if(!Array.isArray(c[k])||(c[k] as unknown[]).length!==4||(c[k] as unknown[]).some(n=>n!==10001))invalid();
  for(const k of ['rlimitAS','rlimitNPROC'])if(!Array.isArray(c[k])||(c[k] as unknown[]).length!==2||(c[k] as unknown[]).some(n=>!integer(n)))invalid();
  if(JSON.stringify(c.rlimitAS)!=='[536870912,536870912]'||JSON.stringify(c.rlimitNPROC)!=='[64,64]')invalid();
  const n=object(c.network,['seccompMode','childSetupAcknowledged','specificFilterObserved','platformFallbackConfigured']);
  if(!integer(n.seccompMode)||![0,1,2].includes(Number(n.seccompMode))||n.childSetupAcknowledged!==true||n.specificFilterObserved!==false||typeof n.platformFallbackConfigured!=='boolean')invalid();
 }
 return v;
}
