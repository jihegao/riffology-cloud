import {DurableObject} from 'cloudflare:workers';
import {G5_GLOBAL_ACTOR,G5WindowGuard,g5WindowPolicy,readG5WindowSnapshot} from './g5-window.ts';
export interface G5WindowEnv{G5_CONTROLLED_WINDOW_JSON?:string;G5_WINDOW_GUARD:DurableObjectNamespace<G5ControlledWindow>}
/** Private binding only. No public fetch route, timer resets or caller window parameter. */
export class G5ControlledWindow extends DurableObject<G5WindowEnv>{
 #guard(){if(!this.env.G5_WINDOW_GUARD.idFromName(G5_GLOBAL_ACTOR).equals(this.ctx.id))throw Error('g5-window-actor-scope-denied');return new G5WindowGuard(this.ctx.storage,g5WindowPolicy(this.env.G5_CONTROLLED_WINDOW_JSON===undefined?undefined:JSON.parse(this.env.G5_CONTROLLED_WINDOW_JSON)));}
 async admitTask(task:unknown){return this.#guard().admitTask(task);}
 async bindTask(key:string,boundId:string){return this.#guard().bindTask(key,boundId);}
 async reserveCall(call:unknown){return this.#guard().reserveCall(call);}
 async claimDispatch(key:string){return this.#guard().claimDispatch(key);}
 async markUnknown(key:string){return this.#guard().markUnknown(key);}
 async recordUsage(key:string,usage:unknown){return this.#guard().recordUsage(key,usage);}
 async settle(key:string,settlement:unknown){return this.#guard().settle(key,settlement);}
 async closeAdmission(){return this.#guard().closeAdmission();}
 async snapshot(){if(!this.env.G5_WINDOW_GUARD.idFromName(G5_GLOBAL_ACTOR).equals(this.ctx.id))throw Error('g5-window-actor-scope-denied');return readG5WindowSnapshot(this.ctx.storage,g5WindowPolicy(this.env.G5_CONTROLLED_WINDOW_JSON===undefined?undefined:JSON.parse(this.env.G5_CONTROLLED_WINDOW_JSON)));}
}
