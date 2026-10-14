import { positive, sha, turnDigest, turnId } from '../turn/protocol.ts';
import { PROJECT_EFFECT_MAX_STDERR_BYTES, PROJECT_EFFECT_MAX_STDOUT_BYTES, PROJECT_FILE_PROGRAM, PROJECT_WORKSPACE_ROOT, validateProjectEffectProcessObservation, type ProjectEffectProcessObservation, type ProjectEffectStart, type ProjectEffectSupervisorPort } from './effect.ts';

export type ProjectEffectSupervisorStorage=Pick<DurableObjectStorage,'sql'|'transactionSync'|'sync'>;
export type ProjectQuiescenceProof={schemaVersion:1;sealed:true;quiescent:true;projectUid:10001};
export interface NativeProjectEffectPort{
  /** Must use effectId as its native process id and refuse a second start. */
  start(input:ProjectEffectStart):Promise<ProjectEffectProcessObservation>;
  observe(effectId:string):Promise<ProjectEffectProcessObservation>;
  sealAndDrain():Promise<ProjectQuiescenceProof>;
}
type Row=Record<string,SqlStorageValue>;
type StoredPhase='prepared'|'running'|'unknown'|'exited';
const PHASES=new Set<StoredPhase>(['prepared','running','unknown','exited']);
const encoder=new TextEncoder();

function reject(code:string):never{throw Error(code);}
function canonical(value:unknown):string{return JSON.stringify(value);}
function exact(value:unknown,keys:string[],code:string):asserts value is Record<string,unknown>{
  if(!value||typeof value!=='object'||Array.isArray(value)||Object.getPrototypeOf(value)!==Object.prototype||Object.keys(value).length!==keys.length||keys.some(key=>!Object.hasOwn(value,key)))reject(code);
}
function startRequest(value:unknown):ProjectEffectStart{
  exact(value,['effectId','program','argv','cwd','env','stdin','timeoutMs'],'invalid-project-effect-start');
  if(value.program!==PROJECT_FILE_PROGRAM||value.cwd!==PROJECT_WORKSPACE_ROOT||!Array.isArray(value.argv)||value.argv.length!==0)reject('invalid-project-effect-start');
  exact(value.env,['LANG','PATH','RIFFOLOGY_WORKSPACE_ROOT'],'invalid-project-effect-start');
  if(value.env.LANG!=='C.UTF-8'||value.env.PATH!=='/usr/bin:/bin'||value.env.RIFFOLOGY_WORKSPACE_ROOT!==PROJECT_WORKSPACE_ROOT||typeof value.stdin!=='string'||encoder.encode(value.stdin).byteLength>1_100_000)reject('invalid-project-effect-start');
  const timeoutMs=positive(value.timeoutMs);if(timeoutMs>120_000)reject('invalid-project-effect-start');
  return {effectId:turnId(value.effectId),program:PROJECT_FILE_PROGRAM,argv:[],cwd:PROJECT_WORKSPACE_ROOT,env:{LANG:'C.UTF-8',PATH:'/usr/bin:/bin',RIFFOLOGY_WORKSPACE_ROOT:PROJECT_WORKSPACE_ROOT},stdin:value.stdin,timeoutMs};
}
function cloneObservation(value:ProjectEffectProcessObservation):ProjectEffectProcessObservation{return structuredClone(value);}
function persistedObservation(row:Row):{phase:StoredPhase;observation:ProjectEffectProcessObservation}{
  try{
    const effectId=turnId(row.effect_id),phase=row.phase as StoredPhase,createdAt=positive(row.created_at),updatedAt=positive(row.updated_at);sha(row.start_digest);if(!PHASES.has(phase)||updatedAt<createdAt)throw Error();
    if(phase==='exited'){
      if(row.start_json!==null)return reject('invalid-persisted-project-effect');
      return {phase,observation:validateProjectEffectProcessObservation({schemaVersion:1,effectId,phase:'exited',exitCode:row.exit_code,stdout:row.stdout,stderr:row.stderr},effectId)};
    }
    if(row.exit_code!==null||row.stdout!==null||row.stderr!==null||typeof row.start_json!=='string')throw Error();
    const start=startRequest(JSON.parse(row.start_json));if(start.effectId!==effectId)throw Error();
    const outward=phase==='running'?'running':'unknown';return {phase,observation:{schemaVersion:1,effectId,phase:outward,exitCode:null,stdout:null,stderr:null}};
  }catch{reject('invalid-persisted-project-effect');}
}

/** Reads only an existing terminal row and never initializes storage or calls native. */
export function readPersistedProjectEffectTerminal(storage:Pick<DurableObjectStorage,'sql'>,rawEffectId:string):ProjectEffectProcessObservation|null{
  const effectId=turnId(rawEffectId),exists=storage.sql.exec("SELECT name FROM sqlite_master WHERE type='table' AND name='project_effects'").toArray()[0];
  if(!exists)return null;
  const row=storage.sql.exec<Row>('SELECT * FROM project_effects WHERE effect_id=?',effectId).toArray()[0];if(!row)return null;
  const found=persistedObservation(row);return found.phase==='exited'?cloneObservation(found.observation):null;
}

/** Persists the one native-start decision before crossing into the container.
 * A prepared/running/unknown effect can only be observed; no later call may
 * issue another native start even when the native process is absent. */
export class SqlProjectEffectSupervisor implements ProjectEffectSupervisorPort{
  #storage:ProjectEffectSupervisorStorage;#native:NativeProjectEffectPort;#clock:()=>number;#ready:Promise<void>;
  constructor(storage:ProjectEffectSupervisorStorage,native:NativeProjectEffectPort,clock:()=>number=Date.now){
    if(!storage?.sql?.exec||!storage.transactionSync||!storage.sync)reject('sqlite-project-effect-supervisor-required');
    this.#storage=storage;this.#native=native;this.#clock=clock;
    storage.transactionSync(()=>storage.sql.exec(`CREATE TABLE IF NOT EXISTS project_effects (
      effect_id TEXT PRIMARY KEY, start_digest TEXT NOT NULL, start_json TEXT,
      phase TEXT NOT NULL CHECK(phase IN ('prepared','running','unknown','exited')),
      exit_code INTEGER, stdout TEXT, stderr TEXT, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
      CHECK((phase='exited' AND exit_code IS NOT NULL AND stdout IS NOT NULL AND stderr IS NOT NULL AND start_json IS NULL) OR
            (phase!='exited' AND exit_code IS NULL AND stdout IS NULL AND stderr IS NULL AND start_json IS NOT NULL))
    ) STRICT;`));
    storage.transactionSync(()=>storage.sql.exec(`CREATE TABLE IF NOT EXISTS project_effect_fence (
      id INTEGER PRIMARY KEY CHECK(id=1), sealed_at INTEGER NOT NULL
    ) STRICT;`));
    this.#ready=storage.sync();
  }
  ready(){return this.#ready;}
  #rows(sql:string,...bindings:(string|number|null)[]):Row[]{return this.#storage.sql.exec<Row>(sql,...bindings).toArray();}
  #get(effectId:string):Row|undefined{return this.#rows('SELECT * FROM project_effects WHERE effect_id=?',effectId)[0];}
  #read(row:Row):{phase:StoredPhase;observation:ProjectEffectProcessObservation}{
    return persistedObservation(row);
  }
  async start(value:ProjectEffectStart):Promise<ProjectEffectProcessObservation>{
    const input=startRequest(value),digest=await turnDigest(input);await this.#ready;let created=false;
    const persisted=this.#storage.transactionSync(()=>{
      const prior=this.#get(input.effectId);if(prior){if(prior.start_digest!==digest)reject('project-effect-idempotency-conflict');return this.#read(prior).observation;}
      if(this.#rows('SELECT id FROM project_effect_fence WHERE id=1').length)reject('project-effects-sealed');
      const now=positive(this.#clock());this.#storage.sql.exec("INSERT INTO project_effects VALUES (?,?,?,'prepared',NULL,NULL,NULL,?,?)",input.effectId,digest,canonical(input),now,now);created=true;return this.#read(this.#get(input.effectId)!).observation;
    });
    await this.#storage.sync();if(!created)return cloneObservation(persisted);
    try{return await this.#commit(input.effectId,await this.#native.start(input));}
    catch(error){await this.#unknown(input.effectId);throw error;}
  }
  async observe(rawEffectId:string):Promise<ProjectEffectProcessObservation>{
    const effectId=turnId(rawEffectId);await this.#ready;const prior=this.#get(effectId);
    if(!prior)return {schemaVersion:1,effectId,phase:'absent',exitCode:null,stdout:null,stderr:null};
    const stored=this.#read(prior);if(stored.phase==='exited')return cloneObservation(stored.observation);
    try{return await this.#commit(effectId,await this.#native.observe(effectId));}
    catch(error){await this.#unknown(effectId);throw error;}
  }
  async observePersistedTerminal(rawEffectId:string):Promise<ProjectEffectProcessObservation|null>{
    const effectId=turnId(rawEffectId);await this.#ready;const prior=this.#get(effectId);
    if(!prior)return null;const stored=this.#read(prior);
    return stored.phase==='exited'?cloneObservation(stored.observation):null;
  }
  /** The container fence covers even native starts already reserved in SQLite.
   * Quiescence is independent of effect outcomes: killing a writer does not
   * prove whether its filesystem operation completed. Recheck on every call. */
  async sealForCheckpoint():Promise<void>{
    await this.#ready;
    this.#storage.transactionSync(()=>this.#storage.sql.exec('INSERT OR IGNORE INTO project_effect_fence(id,sealed_at) VALUES (1,?)',positive(this.#clock())));
    await this.#storage.sync();
    const proof=await this.#native.sealAndDrain();
    exact(proof,['schemaVersion','sealed','quiescent','projectUid'],'invalid-project-quiescence-proof');
    if(proof.schemaVersion!==1||proof.sealed!==true||proof.quiescent!==true||proof.projectUid!==10001)reject('invalid-project-quiescence-proof');
  }
  async #unknown(effectId:string):Promise<void>{
    this.#storage.transactionSync(()=>{const row=this.#get(effectId);if(!row)reject('project-effect-not-found');const current=this.#read(row);if(current.phase!=='exited')this.#storage.sql.exec("UPDATE project_effects SET phase='unknown',updated_at=? WHERE effect_id=?",positive(this.#clock()),effectId);});
    await this.#storage.sync();
  }
  async #commit(effectId:string,value:unknown):Promise<ProjectEffectProcessObservation>{
    const found=validateProjectEffectProcessObservation(value,effectId),normalized=found.phase==='absent'?{...found,phase:'unknown' as const}:found;
    const result=this.#storage.transactionSync(()=>{
      const row=this.#get(effectId);if(!row)reject('project-effect-not-found');const current=this.#read(row);if(current.phase==='exited')return current.observation;
      const now=positive(this.#clock());
      if(normalized.phase==='exited')this.#storage.sql.exec("UPDATE project_effects SET phase='exited',exit_code=?,stdout=?,stderr=?,start_json=NULL,updated_at=? WHERE effect_id=?",normalized.exitCode,normalized.stdout,normalized.stderr,now,effectId);
      else this.#storage.sql.exec('UPDATE project_effects SET phase=?,updated_at=? WHERE effect_id=?',normalized.phase,now,effectId);
      return this.#read(this.#get(effectId)!).observation;
    });
    await this.#storage.sync();return cloneObservation(result);
  }
}

export const projectEffectSupervisorBounds={stdoutBytes:PROJECT_EFFECT_MAX_STDOUT_BYTES,stderrBytes:PROJECT_EFFECT_MAX_STDERR_BYTES};
