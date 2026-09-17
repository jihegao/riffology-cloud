/** Actor-local attempted calls; these are not successful execution receipts.
 * Reads never create storage, SDK sessions or containers. */
export const NATIVE_ATTEMPT_KEY='g4:native-attempts:v1';
export const NATIVE_OWNER_KEY='g4:native-owner:v1';
export type NativeAttemptTag='init'|'startProcess'|'execControl'|'execFilework'|'taskStart';
export type NativeAttempts=Record<NativeAttemptTag,number>;
type Storage=Pick<DurableObjectStorage,'kv'|'transactionSync'|'sync'>;
export function recordNativeAttempt(storage:Storage,tag:NativeAttemptTag){
 storage.transactionSync(()=>{
  const value=storage.kv.get<NativeAttempts>(NATIVE_ATTEMPT_KEY)??{init:0,startProcess:0,execControl:0,execFilework:0,taskStart:0};
  if(!Number.isSafeInteger(value[tag])||value[tag]<0||value[tag]===Number.MAX_SAFE_INTEGER)throw Error('native-attempt-count-invalid');
  storage.kv.put(NATIVE_ATTEMPT_KEY,{...value,[tag]:value[tag]+1});
 });
}
export function nativeAttemptSnapshot(storage:Pick<Storage,'kv'>,actorId:string){
 const attempts=storage.kv.get<NativeAttempts>(NATIVE_ATTEMPT_KEY)??null;
 if(attempts&&(Object.keys(attempts).length!==5||['init','startProcess','execControl','execFilework','taskStart'].some(tag=>!Number.isSafeInteger(attempts[tag as NativeAttemptTag])||attempts[tag as NativeAttemptTag]<0)))throw Error('native-attempt-count-invalid');
 return {schema:'riffology.g4-native-attempts/v1' as const,actorId,supported:attempts!==null,noAddedCalls:true as const,semantics:'attempt-before-call' as const,attempts};
}
export function execAttemptTag(command:string):NativeAttemptTag{
 return /(?:observer|inspect|status|quiescen|seal|fence)/i.test(command)?'execControl':'execFilework';
}

export function bindNativeOwner(storage:Storage,identity:unknown){
 storage.transactionSync(()=>{const prior=storage.kv.get(NATIVE_OWNER_KEY);if(prior&&JSON.stringify(prior)!==JSON.stringify(identity))throw Error('sandbox-counter-owner-conflict');storage.kv.put(NATIVE_OWNER_KEY,identity);});
}
