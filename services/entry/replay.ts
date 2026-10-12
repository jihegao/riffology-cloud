import {DurableObject} from 'cloudflare:workers';
import {replayShard,validTime,FUTURE_SKEW_MS,type ReplayClaim} from './signature.ts';
interface ReplayEnv {ENTRY_REPLAY:DurableObjectNamespace<EntryReplayGuard>;}
export const REPLAY_SHARD_CAPACITY=4096;
/** Dedicated security store, not application identity/history. Internal RPC only.
 * Fixed64 shards; no per-request actor, alarm, network, retry or public fetch. */
export class EntryReplayGuard extends DurableObject<ReplayEnv> {
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
