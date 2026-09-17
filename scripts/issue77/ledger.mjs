import {DatabaseSync} from 'node:sqlite';
import {chmodSync} from 'node:fs';
import {turnDigest} from '../../services/turn/protocol.ts';
import {usageObservation} from '../../services/turn-runtime/backend-contract.ts';

export const POLICY = Object.freeze({schemaVersion:1, windowId:'issue77-20260918-internal-v1', model:'gpt-5.6-luna', maxTurns:6, maxSessions:2, durationMs:7_200_000, perTurnMs:300_000, stopThresholdUsd:5, turnHoldUsd:0.75, sessionHoldUsd:0.25, syntheticOnly:true, singleWriter:true, acknowledgeUnknownActualSpend:true, historicalFundsReusable:false});

/** Local operator authority for the bounded internal trial, not the production
 * money ledger. Fixed reservations never refund; unknown stops future input.
 * The exact policy is persisted once and cannot reset by changing window IDs. */
export class Issue77Ledger {
  constructor(path, clock=Date.now) {
    this.clock=clock; this.db=new DatabaseSync(path); if(path!==':memory:')chmodSync(path,0o600);
    this.db.exec('PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; CREATE TABLE IF NOT EXISTS trial (id INTEGER PRIMARY KEY CHECK(id=1), policy TEXT NOT NULL, started_at INTEGER, stopped TEXT); CREATE TABLE IF NOT EXISTS inputs (key TEXT PRIMARY KEY, input TEXT NOT NULL, operation TEXT NOT NULL, reserved_at INTEGER NOT NULL, observed TEXT, model_cost REAL, cleanup INTEGER NOT NULL DEFAULT 0)');
    this.db.prepare('INSERT OR IGNORE INTO trial VALUES (1,?,NULL,NULL)').run(JSON.stringify(POLICY));
    if(this.db.prepare('SELECT policy FROM trial').get().policy!==JSON.stringify(POLICY))throw Error('issue77-policy-conflict');
    this.storage={sql:{exec:(sql,...args)=>{const q=this.db.prepare(sql),rows=q.columns().length?q.all(...args):(q.run(...args),[]);return {toArray:()=>rows};}},transactionSync:fn=>this.transaction(fn),sync:async()=>{}};
  }
  transaction(fn) {this.db.exec('BEGIN IMMEDIATE');try{const result=fn();this.db.exec('COMMIT');return result;}catch(error){this.db.exec('ROLLBACK');throw error;}}
  async key(binding) {return turnDigest(binding.identity);}
  async reserve(binding,operation,input) {
    const key=await this.key(binding); if(await turnDigest(input)!==binding.inputSha256)throw Error('issue77-input-digest-conflict');
    this.transaction(()=>{
      const state=this.db.prepare('SELECT * FROM trial').get(), rows=this.db.prepare('SELECT * FROM inputs').all(), now=this.clock();
      if(state.stopped||state.started_at!==null&&now>=state.started_at+POLICY.durationMs)throw Error('issue77-admission-closed');
      if(rows.some(row=>row.key===key))throw Error('issue77-input-already-reserved');
      if(rows.some(row=>!row.observed))throw Error('issue77-prior-outcome-unresolved');
      if(operation==='create'&&rows.some(row=>row.cleanup!==1))throw Error('issue77-prior-cleanup-unconfirmed');
      if(rows.length>=POLICY.maxTurns||operation==='create'&&rows.filter(r=>r.operation==='create').length>=POLICY.maxSessions)throw Error('issue77-attempt-cap');
      if(!['create','continue'].includes(operation))throw Error('issue77-operation-invalid');
      const held=rows.reduce((sum,r)=>sum+Math.max(POLICY.turnHoldUsd,r.model_cost??0)+(r.operation==='create'?POLICY.sessionHoldUsd:0),0);
      if(held+POLICY.turnHoldUsd+(operation==='create'?POLICY.sessionHoldUsd:0)>POLICY.stopThresholdUsd)throw Error('issue77-money-threshold');
      this.db.prepare('UPDATE trial SET started_at=COALESCE(started_at,?) WHERE id=1').run(now);
      this.db.prepare('INSERT INTO inputs (key,input,operation,reserved_at) VALUES (?,?,?,?)').run(key,JSON.stringify(input),operation,now);
    });
  }
  async readInput(binding) {const row=this.db.prepare('SELECT input FROM inputs WHERE key=?').get(await this.key(binding));return row?JSON.parse(row.input):null;}
  async record(binding,receipt) {
    if(await turnDigest(receipt.identity)!==await turnDigest(binding.identity)||receipt.sessionId!==binding.remoteSessionId||receipt.turnId!==binding.remoteTurnId)throw Error('issue77-receipt-scope-denied');
    const key=await this.key(binding), usage=usageObservation(receipt.usage);
    this.transaction(()=>{
      if(!this.db.prepare('SELECT key FROM inputs WHERE key=?').get(key))throw Error('issue77-unreserved-receipt');
      if(!['completed','failed','cancelled'].includes(receipt.phase))throw Error('issue77-terminal-required');
      // Conservative upper standard rate (including high-context input/cache
      // writes), not an invoice or a claim of final provider settlement.
      const cost=usage.status==='observed'?(usage.inputTokens*0.5+usage.outputTokens*1.8)/1_000_000:null;
      const previous=this.db.prepare('SELECT model_cost FROM inputs WHERE key=?').get(key).model_cost;
      this.db.prepare('UPDATE inputs SET observed=?, model_cost=? WHERE key=?').run(JSON.stringify({phase:receipt.phase,usage}),cost===null?previous:Math.max(previous??0,cost),key);
      if(usage.status==='unknown'||cost>POLICY.turnHoldUsd)this.db.prepare('UPDATE trial SET stopped=COALESCE(stopped,?) WHERE id=1').run(usage.status==='unknown'?'usage-unknown':'turn-observed-cost-exceeds-hold');
    });
  }
  stop(reason) {this.db.prepare('UPDATE trial SET stopped=COALESCE(stopped,?) WHERE id=1').run(reason);}
  async cleaned(binding) {const local=binding.identity.sessionId;this.transaction(()=>{for(const row of this.db.prepare('SELECT key,input FROM inputs').all())if(JSON.parse(row.input).identity.sessionId===local)this.db.prepare('UPDATE inputs SET cleanup=1 WHERE key=?').run(row.key);});}
  summary() {const state=this.db.prepare('SELECT started_at,stopped FROM trial').get(),rows=this.db.prepare('SELECT operation,observed,model_cost FROM inputs').all();return {schemaVersion:1,policy:POLICY,startedAt:state.started_at,deadline:state.started_at===null?null:state.started_at+POLICY.durationMs,stopped:state.stopped,attempts:rows.length,sessions:rows.filter(r=>r.operation==='create').length,unknown:rows.filter(r=>!r.observed||JSON.parse(r.observed).usage.status==='unknown').length,conservativeReservedUsd:rows.reduce((s,r)=>s+Math.max(POLICY.turnHoldUsd,r.model_cost??0)+(r.operation==='create'?POLICY.sessionHoldUsd:0),0),observedModelCostUpperEstimateUsd:rows.reduce((s,r)=>s+(r.model_cost??0),0),billingSettled:false};}
  close(){this.db.close();}
}
