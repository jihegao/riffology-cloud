import {DurableObject} from 'cloudflare:workers';
import {replayShard,validTime,FUTURE_SKEW_MS,type ReplayClaim} from './signature.ts';
import {VALIDATION_ACTOR,validationConfig,validationTime,validationClaimAllowed,validationBits,validationRequiredMask,
  type ValidationClaim,type ValidationEnv} from './validation-policy.ts';
interface ReplayEnv extends ValidationEnv {ENTRY_REPLAY:DurableObjectNamespace<EntryReplayGuard>;}
export const REPLAY_SHARD_CAPACITY=4096;
/** Dedicated security store, not application identity/history. Internal RPC only.
 * Fixed64 shards; no per-request actor, alarm, network, retry or public fetch. */
export class EntryReplayGuard extends DurableObject<ReplayEnv> {
  /** Temporary maintenance budget; original claim below is unchanged. No
   * credential/IP/proof/body storage, no new namespace or actor name family. */
  validationTake(value:ValidationClaim):'accepted'|'spent' {
    const c=validationConfig(this.env);validationTime(c);
    if(!validationClaimAllowed(value,c)||!this.env.ENTRY_REPLAY.idFromName(VALIDATION_ACTOR).equals(this.ctx.id))throw Error('validation-scope-denied');
    const sql=this.ctx.storage.sql,bit=validationBits[value.action],required=validationRequiredMask(value.action);
    return this.ctx.storage.transactionSync(()=>{
      sql.exec('CREATE TABLE IF NOT EXISTS riffoid_validation_budget_v1(run_id TEXT NOT NULL,slot TEXT NOT NULL,mask INTEGER NOT NULL,expires INTEGER NOT NULL,PRIMARY KEY(run_id,slot))');
      const rows=sql.exec<{mask:number;expires:number}>('SELECT mask,expires FROM riffoid_validation_budget_v1 WHERE run_id=? AND slot=?',c.run,value.slot).toArray();
      const mask=rows[0]?.mask??0;
      if(rows[0]&&rows[0].expires!==c.expires||mask&bit||(mask&required)!==required||
        sql.exec('SELECT slot FROM riffoid_validation_budget_v1 WHERE slot=?','closed').toArray().length)return 'spent';
      if(!rows.length&&sql.exec<{n:number}>('SELECT count(*) n FROM riffoid_validation_budget_v1').one().n>=3)return 'spent';
      sql.exec('INSERT INTO riffoid_validation_budget_v1 VALUES(?,?,?,?) ON CONFLICT(run_id,slot) DO UPDATE SET mask=excluded.mask',c.run,value.slot,mask|bit,c.expires);
      return 'accepted';
    });
  }
  /** Own +30s cleanup interval. One closed-run tombstone prevents a lost
   * cleanup receipt from reopening the run. Original nonce table untouched. */
  validationCleanup(run:string):number {
    const c=validationConfig(this.env);validationTime(c,true);
    if(run!==c.run||!this.env.ENTRY_REPLAY.idFromName(VALIDATION_ACTOR).equals(this.ctx.id))throw Error('validation-scope-denied');
    const sql=this.ctx.storage.sql;
    return this.ctx.storage.transactionSync(()=>{
      sql.exec('CREATE TABLE IF NOT EXISTS riffoid_validation_budget_v1(run_id TEXT NOT NULL,slot TEXT NOT NULL,mask INTEGER NOT NULL,expires INTEGER NOT NULL,PRIMARY KEY(run_id,slot))');
      if(sql.exec('SELECT slot FROM riffoid_validation_budget_v1 WHERE slot=?','closed').toArray().length)throw Error('validation-spent');
      const expired=sql.exec('SELECT slot FROM riffoid_validation_budget_v1 WHERE run_id=? AND slot IN (?,?) AND expires<=?',run,'A','B',Date.now()).toArray();
      if(sql.exec<{n:number}>('SELECT count(*) n FROM riffoid_validation_budget_v1').one().n>=3)throw Error('validation-budget-unavailable');
      sql.exec('INSERT INTO riffoid_validation_budget_v1 VALUES(?,?,?,?)',run,'closed',31,c.expires);
      sql.exec('DELETE FROM riffoid_validation_budget_v1 WHERE run_id=? AND slot IN (?,?) AND expires<=?',run,'A','B',Date.now());
      return expired.length;
    });
  }
  claim(value:ReplayClaim):'accepted'|'replay'|'full' {
    if(!value||Object.keys(value).sort().join(',')!=='expires,issued,nonce'||!validTime(value.issued,value.expires,Date.now())||!this.env.ENTRY_REPLAY.idFromName(replayShard(value.nonce)).equals(this.ctx.id))throw Error('entry-replay-scope-denied');
    const now=Date.now(),sql=this.ctx.storage.sql;
    return this.ctx.storage.transactionSync(()=>{
      sql.exec('CREATE TABLE IF NOT EXISTS entry_replay_v1(nonce TEXT PRIMARY KEY,expires INTEGER NOT NULL)');
      sql.exec('CREATE INDEX IF NOT EXISTS entry_replay_expiry_v1 ON entry_replay_v1(expires)');
      sql.exec('DELETE FROM entry_replay_v1 WHERE nonce IN (SELECT nonce FROM entry_replay_v1 WHERE expires<=? ORDER BY expires LIMIT 64)',now);
      if(sql.exec('SELECT nonce FROM entry_replay_v1 WHERE nonce=?',value.nonce).toArray().length)return 'replay';
      if((sql.exec<{n:number}>('SELECT count(*) n FROM entry_replay_v1').one().n)>=REPLAY_SHARD_CAPACITY)return 'full';
      sql.exec('INSERT INTO entry_replay_v1(nonce,expires) VALUES(?,?)',value.nonce,value.expires+FUTURE_SKEW_MS);
      return 'accepted';
    });
  }
}
