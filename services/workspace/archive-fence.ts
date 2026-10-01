import type {TurnScope} from '../turn/protocol.ts';
import {sameScope} from '../turn/protocol.ts';
export type ArchiveFence={scope:TurnScope;operationId:string;epoch:number;action:'archive'|'restore';state:'prepared'|'archived';wasArchived:boolean};
type Store=Pick<DurableObjectStorage,'kv'|'sync'>;
const KEY='project-archive-fence-v1';
/** Every mutation holds a local lease across external awaits. Prepare persists a
 * fence before checking remote release evidence; no new lease can cross it. */
export class WorkspaceArchiveFence {
 #active=0;
 readonly storage:Store;
 constructor(storage:Store){this.storage=storage;}
 get(){return this.storage.kv.get<ArchiveFence>(KEY)??null;}
 assertWritable(scope:TurnScope){const value=this.get();if(value){if(!sameScope(value.scope,scope))throw Error('workspace-actor-scope-denied');throw Error('project_archived');}}
 async read<T>(scope:TurnScope,operation:()=>Promise<T>):Promise<T>{const value=this.get();if(value&&!sameScope(value.scope,scope))throw Error('workspace-actor-scope-denied');this.#active++;try{return await operation();}finally{this.#active--;}}
 async write<T>(scope:TurnScope,operation:()=>Promise<T>):Promise<T>{this.assertWritable(scope);this.#active++;try{return await operation();}finally{this.#active--;}}
 async prepare(value:ArchiveFence){const prior=this.get();if(prior&&prior.operationId===value.operationId&&prior.epoch===value.epoch&&sameScope(prior.scope,value.scope))return;
  if(this.#active!==0)throw Error('project_busy');
  if(prior&&(prior.state!=='archived'||prior.epoch!==value.epoch))throw Error('project_busy');
  if(prior&&!sameScope(prior.scope,value.scope))throw Error('workspace-actor-scope-denied');
  this.storage.kv.put(KEY,value);await this.storage.sync();
 }
 async finish(operationId:string,epoch:number,archived:boolean){const prior=this.get();if(!prior||prior.operationId!==operationId)throw Error('project_busy');if(archived)this.storage.kv.put(KEY,{...prior,epoch,state:'archived'});else this.storage.kv.delete(KEY);await this.storage.sync();}
 async abort(operationId:string){const prior=this.get();if(!prior||prior.operationId!==operationId)return;if(prior.wasArchived)this.storage.kv.put(KEY,{...prior,state:'archived'});else this.storage.kv.delete(KEY);await this.storage.sync();}
 active(){return this.#active;}
}
