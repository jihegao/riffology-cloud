import type {ModelBudgetStorage,ModelCallRequest,ModelCallTerminal} from './core.ts';
export type G4WindowPolicy={schemaVersion:1;windowId:string;tenantId:string;userId:string;provider:'opencode-go';model:'gpt-5.6-luna';rateCardSha256:string;inputNanodollarsPerToken:500;outputNanodollarsPerToken:1800;totalNanodollars:20000000000;turnNanodollars:5000000000;maxUpstreamDispatches:32;maxServerRuns:16;durationMs:7200000};
export type G4Task={tenantId:string;userId:string;kind:'project'|'turn'|'run';key:string;digest:string};
const fail=(code:string):never=>{throw Error('g4-window-'+code);};
const id=(v:unknown)=>typeof v==='string'&&/^[A-Za-z0-9][A-Za-z0-9._:-]{0,149}$/.test(v)?v:fail('identity-invalid');
const hash=(v:unknown)=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v)?v:fail('digest-invalid');
const keys=['schemaVersion','windowId','tenantId','userId','provider','model','rateCardSha256','inputNanodollarsPerToken','outputNanodollarsPerToken','totalNanodollars','turnNanodollars','maxUpstreamDispatches','maxServerRuns','durationMs'];
export function g4WindowPolicy(raw:unknown):G4WindowPolicy|null{
 if(raw===undefined)return null;
 if(!raw||typeof raw!=='object'||Array.isArray(raw)||Object.getPrototypeOf(raw)!==Object.prototype||Object.keys(raw).length!==keys.length||keys.some(k=>!Object.hasOwn(raw,k)))return fail('configuration-invalid');
 const p=raw as G4WindowPolicy;id(p.windowId);id(p.tenantId);id(p.userId);hash(p.rateCardSha256);
 if(p.schemaVersion!==1||p.provider!=='opencode-go'||p.model!=='gpt-5.6-luna'||p.inputNanodollarsPerToken!==500||p.outputNanodollarsPerToken!==1800||p.totalNanodollars!==20000000000||p.turnNanodollars!==5000000000||p.maxUpstreamDispatches!==32||p.maxServerRuns!==16||p.durationMs!==7200000)return fail('configuration-invalid');
 return Object.fromEntries(keys.map(k=>[k,p[k as keyof G4WindowPolicy]])) as G4WindowPolicy;
}
/** Shares the token actor SQLite transaction. These *Sync methods never open
 * nested transactions: token admission/dispatch/finish and money are one commit.
 * Reserved/dispatched/unknown charges never expire and block fresh window tasks. */
export class G4WindowGuard{
 readonly storage:ModelBudgetStorage;readonly configured:G4WindowPolicy|null;readonly now:()=>number;
 constructor(storage:ModelBudgetStorage,configured:G4WindowPolicy|null,now=Date.now){
  this.storage=storage;this.configured=configured;this.now=now;
  storage.sql.exec('CREATE TABLE IF NOT EXISTS g4_window_policy(singleton INTEGER PRIMARY KEY,document TEXT NOT NULL,started_at INTEGER NOT NULL)');
  storage.sql.exec('CREATE TABLE IF NOT EXISTS g4_window_tasks(key TEXT PRIMARY KEY,digest TEXT NOT NULL,kind TEXT NOT NULL,accepted_at INTEGER NOT NULL)');
  storage.sql.exec('CREATE TABLE IF NOT EXISTS g4_window_calls(key TEXT PRIMARY KEY,turn_key TEXT NOT NULL,reserved INTEGER NOT NULL,accounted INTEGER NOT NULL,state TEXT NOT NULL,dispatch_at INTEGER,terminal TEXT)');
 }
 #meta(){return this.storage.sql.exec<{document:string;started_at:number}>('SELECT document,started_at FROM g4_window_policy WHERE singleton=1').toArray()[0];}
 #policy(){const m=this.#meta();if(!this.configured){if(m)fail('configuration-removed');return null;}if(m&&m.document!==JSON.stringify(this.configured))fail('policy-conflict');return this.configured;}
 #scope(tenantId:string,userId:string){const p=this.#policy();if(p&&(tenantId!==p.tenantId||userId!==p.userId))fail('scope-denied');return p;}
 #admit(tenantId:string,userId:string,start=true){const p=this.#scope(tenantId,userId);if(!p)return null;const m=this.#meta();if(m&&this.now()>=m.started_at+p.durationMs)fail('deadline');
  if(this.storage.sql.exec("SELECT 1 FROM g4_window_calls WHERE state IN ('reserved','dispatched','unknown') LIMIT 1").toArray().length)fail('charge-unsettled');
  if(!m&&start)this.storage.sql.exec('INSERT INTO g4_window_policy VALUES(1,?,?)',JSON.stringify(p),this.now());return p;
 }
 taskSync(task:G4Task){id(task.tenantId);id(task.userId);hash(task.key);hash(task.digest);if(!['project','turn','run'].includes(task.kind))fail('task-kind-invalid');const p=this.#scope(task.tenantId,task.userId);if(!p)return {guarded:false,replayed:false};
  const prior=this.storage.sql.exec<{digest:string;kind:string}>('SELECT digest,kind FROM g4_window_tasks WHERE key=?',task.key).toArray()[0];if(prior){if(prior.digest!==task.digest||prior.kind!==task.kind)fail('intent-conflict');return {guarded:true,replayed:true};}
  this.#admit(task.tenantId,task.userId);
  if(task.kind==='run'&&this.storage.sql.exec<{n:number}>("SELECT count(*) AS n FROM g4_window_tasks WHERE kind='run'").toArray()[0]!.n>=p.maxServerRuns)fail('run-limit');
  this.storage.sql.exec('INSERT INTO g4_window_tasks VALUES(?,?,?,?)',task.key,task.digest,task.kind,this.now());return {guarded:true,replayed:false};
 }
 #cost(input:number,output:number){if(!Number.isSafeInteger(input)||input<0||!Number.isSafeInteger(output)||output<0)fail('token-bound-invalid');const total=BigInt(input)*500n+BigInt(output)*1800n;if(total>BigInt(Number.MAX_SAFE_INTEGER))fail('money-overflow');return Number(total);}
 reserveSync(request:ModelCallRequest,key:string,turnKey:string){const p=this.#scope(request.identity.scope.tenantId,request.actor.userId);if(!p)return;
  if(request.provider!==p.provider||request.model!==p.model||request.inputBoundVersion!=='utf8-provider-payload-plus-4096-v1')fail('provider-or-bound-denied');
  if(this.storage.sql.exec('SELECT 1 FROM g4_window_calls WHERE key=?',key).toArray().length)return;
  if(this.storage.sql.exec<{n:number}>('SELECT count(*) AS n FROM g4_window_calls WHERE dispatch_at IS NOT NULL').toArray()[0]!.n>=p.maxUpstreamDispatches)fail('dispatch-limit');
  this.#admit(request.identity.scope.tenantId,request.actor.userId);const cost=this.#cost(request.inputTokenUpperBound,request.maxOutputTokens);
  let total=0n,turn=0n;for(const r of this.storage.sql.exec<{turn_key:string;accounted:number}>('SELECT turn_key,accounted FROM g4_window_calls').toArray()){if(!Number.isSafeInteger(r.accounted)||r.accounted<0)fail('ledger-invalid');total+=BigInt(r.accounted);if(r.turn_key===turnKey)turn+=BigInt(r.accounted);}
  if(total+BigInt(cost)>BigInt(p.totalNanodollars)||turn+BigInt(cost)>BigInt(p.turnNanodollars))fail('money-cap');
  this.storage.sql.exec("INSERT INTO g4_window_calls VALUES(?,?,?,?,'reserved',NULL,NULL)",key,turnKey,cost,cost);
 }
 dispatchSync(key:string){const p=this.#policy();if(!p)return;const m=this.#meta();if(!m||this.now()>=m.started_at+p.durationMs)fail('deadline');
  const r=this.storage.sql.exec<{state:string}>('SELECT state FROM g4_window_calls WHERE key=?',key).toArray()[0];if(!r||r.state!=='reserved')fail('dispatch-observe-only');
  if(this.storage.sql.exec("SELECT 1 FROM g4_window_calls WHERE key!=? AND state IN ('reserved','dispatched','unknown') LIMIT 1",key).toArray().length)fail('charge-unsettled');
  if(this.storage.sql.exec<{n:number}>('SELECT count(*) AS n FROM g4_window_calls WHERE dispatch_at IS NOT NULL').toArray()[0]!.n>=p.maxUpstreamDispatches)fail('dispatch-limit');
  this.storage.sql.exec("UPDATE g4_window_calls SET state='dispatched',dispatch_at=? WHERE key=?",this.now(),key);
 }
 unknownSync(key:string){this.storage.sql.exec("UPDATE g4_window_calls SET state='unknown' WHERE key=? AND state='dispatched'",key);}
 finishSync(key:string,terminal:ModelCallTerminal){const r=this.storage.sql.exec<{state:string;reserved:number;terminal:string|null}>('SELECT state,reserved,terminal FROM g4_window_calls WHERE key=?',key).toArray()[0];if(!r)return;if(r.state==='recorded'){if(r.terminal!==JSON.stringify(terminal))fail('terminal-conflict');return;}
  if(terminal.usage.kind!=='verified'||!terminal.providerRequestId){this.storage.sql.exec("UPDATE g4_window_calls SET state='unknown',terminal=? WHERE key=?",JSON.stringify(terminal),key);return;}
  const accounted=this.#cost(terminal.usage.inputTokens,terminal.usage.outputTokens);if(accounted>r.reserved)fail('usage-over-bound');this.storage.sql.exec("UPDATE g4_window_calls SET state='recorded',accounted=?,terminal=? WHERE key=?",accounted,JSON.stringify(terminal),key);
 }
 releaseSync(key:string){this.storage.sql.exec("UPDATE g4_window_calls SET state='released',accounted=0 WHERE key=? AND state='reserved'",key);}
 deadlineAt(){const m=this.#meta();return m?m.started_at+7200000:null;}
 snapshot(){return readG4WindowSnapshot(this.storage,this.configured);}
}

/** No constructor/schema creation: a before-first-task GET never writes SQLite. */
export function readG4WindowSnapshot(storage:ModelBudgetStorage,configured:G4WindowPolicy|null){
 const tables=storage.sql.exec<{name:string}>("SELECT name FROM sqlite_master WHERE type='table' AND name IN ('g4_window_policy','g4_window_tasks','g4_window_calls')").toArray();
 if(!tables.length)return {schemaVersion:1,configured:configured!==null,policy:configured,startedAt:null,deadlineAt:null,tasks:[],calls:[]};
 if(tables.length!==3)fail('schema-incomplete');
 const m=storage.sql.exec<{document:string;started_at:number}>('SELECT document,started_at FROM g4_window_policy WHERE singleton=1').toArray()[0];
 return {schemaVersion:1,configured:configured!==null,policy:m?JSON.parse(m.document):configured,startedAt:m?.started_at??null,deadlineAt:m?m.started_at+7200000:null,tasks:storage.sql.exec('SELECT * FROM g4_window_tasks ORDER BY accepted_at,key').toArray(),calls:storage.sql.exec('SELECT * FROM g4_window_calls ORDER BY key').toArray()};
}
