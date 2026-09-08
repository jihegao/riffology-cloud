import type { QuotaStorage, Acquisition } from '../quota/core.ts';
import { canonicalWorkspaceMarker, validateWorkspaceTask, workspaceDigest, WORKSPACE_LAYOUT,
  type RuntimeIdentity, type RuntimeInitialize, type RuntimeObservation, type RuntimeReadyReceipt } from '../workspace/protocol.ts';
import { initialCheckpoint, initialFiles, initializationProgram } from './starter.ts';
import { ModelContentError, type ModelContentManifest, type ModelContentPort, type ModelContentReceipt, type VerifiedModelContent } from './content.ts';

export interface NativeRuntimePort {
  readonly running: boolean;
  start(program: string): void;
  installContent(content: VerifiedModelContent): Promise<void>;
  inspectFiles(content?: ModelContentManifest): Promise<Record<string, string> | null>;
  destroy(): Promise<void>;
}
export interface CheckpointPort {
  read(key: string): Promise<string | null>;
  putOnce(key: string, value: string): Promise<void>;
}
export interface RuntimeAuthority {
  verifyTask(input: RuntimeInitialize['task']): Promise<boolean>;
  lookup(tenantId: string, operationId: string): Promise<Acquisition | null>;
}
type State = { identity: RuntimeIdentity; input: RuntimeInitialize | null; startReserved: boolean; checkpointPutReserved: boolean; initializedAt: number | null; fenced: boolean; contentInstallReserved: boolean; contentInstalled: boolean; contentReceipt?: ModelContentReceipt; contentManifest?: ModelContentManifest; observation: RuntimeObservation };
const identityKeys = ['taskId','tenantId','projectId','workspaceId','generation','runtimeId','leaseId'] as const;
export function sameRuntime(a: RuntimeIdentity, b: RuntimeIdentity): boolean { return identityKeys.every(k => a[k] === b[k]); }
function validateIdentity(identity: RuntimeIdentity) {
  if (!identity || Object.keys(identity).length !== identityKeys.length) throw Error('runtime-scope-denied');
  canonicalWorkspaceMarker(identity, 'validation');
}
export function checkpointKey(identity: RuntimeIdentity): string {
  validateIdentity(identity);
  return `workspaces/${identity.tenantId}/${identity.workspaceId}/${identity.generation}/${identity.runtimeId}/initial.json`;
}
/** One native start per persisted runtime identity. A stopped generation is a
 * permanent tombstone. All retry paths observe; no SDK auto-start is involved. */
export class RuntimeCore {
  #storage: QuotaStorage; #native: NativeRuntimePort; #checkpoints: CheckpointPort; #authority: RuntimeAuthority; #content: ModelContentPort | null; #clock: () => number;
  #contentInstall: Promise<void> | null = null;
  constructor(storage: QuotaStorage, native: NativeRuntimePort, checkpoints: CheckpointPort, authority: RuntimeAuthority, clock = Date.now, content: ModelContentPort | null = null) {
    this.#storage=storage; this.#native=native; this.#checkpoints=checkpoints; this.#authority=authority; this.#content=content; this.#clock=clock;
    storage.sql.exec('CREATE TABLE IF NOT EXISTS runtime_state (id INTEGER PRIMARY KEY CHECK(id=1), value TEXT NOT NULL) STRICT');
  }
  #read(): State | null {
    const row=this.#storage.sql.exec<{value:string}>('SELECT value FROM runtime_state WHERE id=1').toArray()[0];
    if (!row) return null;
    const state=JSON.parse(row.value) as State;
    // Older local evidence predates explicit install state. A persisted
    // initializedAt was written only after the complete manifest was observed.
    state.contentInstallReserved ??= Boolean(state.contentReceipt);
    state.contentInstalled ??= Boolean(state.contentReceipt && state.initializedAt!==null);
    return state;
  }
  #write(state: State) { this.#storage.sql.exec('INSERT INTO runtime_state(id,value) VALUES(1,?) ON CONFLICT(id) DO UPDATE SET value=excluded.value',JSON.stringify(state)); }
  #checked(identity: RuntimeIdentity): State | null {
    validateIdentity(identity); const state=this.#read();
    if (state && !sameRuntime(state.identity,identity)) throw Error('runtime-scope-denied');
    return state;
  }
  #empty(identity: RuntimeIdentity): State {
    return {identity:structuredClone(identity),input:null,startReserved:false,checkpointPutReserved:false,initializedAt:null,fenced:false,contentInstallReserved:false,contentInstalled:false,
      observation:{identity:structuredClone(identity),phase:'pending',ready:null,stop:null,failureCode:null}};
  }
  async #authorized(input:RuntimeInitialize):Promise<boolean>{
    const {task,identity}=input,permitted=await this.#authority.verifyTask(task),acquired=await this.#authority.lookup(task.tenantId,task.id),lease=acquired?.lease;
    return Boolean(permitted && lease && lease.status==='dispatched' && lease.leaseId===identity.leaseId &&
      lease.tenantId===task.tenantId && lease.projectId===task.projectId && lease.workspaceId===task.workspaceId &&
      lease.generation===task.generation && lease.operationId===task.id && lease.operation==='workspace-runtime' && lease.deadlineAt===task.deadlineAt);
  }
  async #install(content:VerifiedModelContent):Promise<void>{
    if (!this.#contentInstall) this.#contentInstall=this.#native.installContent(content).finally(()=>{this.#contentInstall=null;});
    return this.#contentInstall;
  }
  async initialize(input: RuntimeInitialize): Promise<RuntimeObservation> {
    validateWorkspaceTask(input.task); validateIdentity(input.identity);
    const {task,identity}=input;
    if (identity.taskId!==task.id || identity.tenantId!==task.tenantId || identity.projectId!==task.projectId ||
      identity.workspaceId!==task.workspaceId || identity.generation!==task.generation) throw Error('runtime-scope-denied');
    canonicalWorkspaceMarker(identity,input.markerNonce);
    let prior=this.#checked(identity);
    if (prior?.input && JSON.stringify(prior.input)!==JSON.stringify(input)) throw Error('runtime-input-conflict');
    if (prior) return this.observe(identity);
    prior=this.#empty(identity); prior.input=structuredClone(input); prior.startReserved=true;
    this.#write(prior); // Reserve before any await; even a lost storage ack cannot replay start.
    await this.#storage.sync();
    try {
      const authorized=await this.#authorized(input);
      const state=this.#checked(identity)!;
      if (state.fenced) return structuredClone(state.observation);
      const unsupported=task.starterVersion!=='blank-v1';
      if (!authorized || this.#clock()>=task.deadlineAt || unsupported) {
        state.observation.phase='failed'; state.observation.failureCode=unsupported?'unsupported-starter':this.#clock()>=task.deadlineAt?'deadline':'scope-denied';
        this.#write(state); await this.#storage.sync(); return structuredClone(state.observation);
      }
      // A catalog model task only carries a frozen reference at this stage. It
      // must never fall through to the blank starter until a trusted resolver
      // has verified and materialized the referenced package bytes.
      let verifiedContent: VerifiedModelContent | undefined;
      if (task.modelContent) {
        if (!this.#content) {
          state.observation.phase='failed'; state.observation.failureCode='unsupported-starter'; this.#write(state); await this.#storage.sync(); return structuredClone(state.observation);
        }
        verifiedContent=await this.#content.resolve(task.modelContent);
        state.contentReceipt=structuredClone(verifiedContent.receipt);state.contentManifest=structuredClone(verifiedContent.manifest);state.contentInstallReserved=true;
        this.#write(state);await this.#storage.sync();
      }
      // No await between the last fence/deadline check and native start.
      if (this.#checked(identity)!.fenced || this.#clock()>=task.deadlineAt) return this.#observe(identity,false);
      if (this.#native.running) throw Error('unexpected-running-container');
      this.#native.start(initializationProgram(input));
      if (verifiedContent) await this.#install(verifiedContent);
      return this.#observe(identity,false);
    } catch (error) {
      const state=this.#checked(identity)!;
      if (!state.fenced) { state.observation.phase=error instanceof ModelContentError?'failed':'unknown'; state.observation.failureCode=error instanceof ModelContentError?error.code:'initialization-unknown'; this.#write(state); await this.#storage.sync(); }
      return structuredClone(this.#checked(identity)!.observation);
    }
  }
  async #ready(input: RuntimeInitialize): Promise<RuntimeReadyReceipt | null> {
    let stateAtStart=this.#checked(input.identity)!;
    const checkpoint=await initialCheckpoint(input,stateAtStart.contentReceipt), key=checkpointKey(input.identity);
    let persisted=await this.#checkpoints.read(key);
    const contentNeedsProof=Boolean(input.task.modelContent && !stateAtStart.contentInstalled);
    if ((persisted===null || contentNeedsProof) && this.#native.running) {
      const files=await this.#native.inspectFiles(stateAtStart.contentManifest);
      if (!files || JSON.stringify(files)!==JSON.stringify(initialFiles(input))) return null;
      if (contentNeedsProof) {
        const state=this.#checked(input.identity)!;
        if (state.fenced || !state.contentInstallReserved || !state.contentReceipt || !state.contentManifest) return null;
        state.contentInstalled=true;this.#write(state);await this.#storage.sync();stateAtStart=this.#checked(input.identity)!;
      }
    }
    if (persisted===null && this.#native.running) {
      // R2 is immutable at this scope/key. An unknown PUT is retried only as a read.
      const state=this.#checked(input.identity)!;
      if (state.checkpointPutReserved) return null;
      if (state.fenced || this.#clock()>=input.task.deadlineAt) return null;
      state.checkpointPutReserved=true; state.initializedAt=this.#clock(); this.#write(state); await this.#storage.sync();
      if (this.#checked(input.identity)!.fenced || this.#clock()>=input.task.deadlineAt) return null;
      await this.#checkpoints.putOnce(key,checkpoint.text);
      persisted=await this.#checkpoints.read(key);
    }
    const initializedAt=this.#checked(input.identity)!.initializedAt;
    const finalState=this.#checked(input.identity)!;
    if (persisted!==checkpoint.text || initializedAt===null || (input.task.modelContent && !finalState.contentInstalled)) return null;
    return {receiptId:`checkpoint-${checkpoint.revision}`,initializedAt,layoutVersion:WORKSPACE_LAYOUT,
      markerSha256:await workspaceDigest(canonicalWorkspaceMarker(input.identity,input.markerNonce)),checkpointRevision:checkpoint.revision,
      ...(finalState.contentReceipt ? { modelContent: structuredClone(finalState.contentReceipt) } : {})};
  }
  async #reconcileContent(input:RuntimeInitialize):Promise<void>{
    const state=this.#checked(input.identity)!;
    if (!input.task.modelContent || state.contentInstalled || !state.contentInstallReserved || !state.contentReceipt || !state.contentManifest ||
      state.fenced || !this.#native.running || this.#clock()>=input.task.deadlineAt || !this.#content) return;
    if (!await this.#authorized(input)) return;
    const verified=await this.#content.resolve(input.task.modelContent);
    const current=this.#checked(input.identity)!;
    if (JSON.stringify(verified.receipt)!==JSON.stringify(current.contentReceipt) || JSON.stringify(verified.manifest)!==JSON.stringify(current.contentManifest))
      throw new ModelContentError('model-content-mismatch');
    if (current.fenced || !this.#native.running || this.#clock()>=input.task.deadlineAt) return;
    await this.#install(verified);
  }
  async #observe(identity: RuntimeIdentity, allowContentReconcile:boolean): Promise<RuntimeObservation> {
    let state=this.#checked(identity);
    if (!state) return this.#empty(identity).observation;
    if (state.input && !state.observation.ready) {
      try {
        let ready=await this.#ready(state.input);
        if (!ready && allowContentReconcile && state.input.task.modelContent) { await this.#reconcileContent(state.input); ready=await this.#ready(state.input); }
        state=this.#checked(identity)!;
        if (ready) { state.observation.ready=ready; if (!state.fenced) state.observation.phase='runtime_ready'; state.observation.failureCode=null; this.#write(state); await this.#storage.sync(); }
      } catch (error) {
        // Unknown checkpoint/file observation is not evidence of permission to
        // restart. A cryptographic content failure is final for this identity.
        if (error instanceof ModelContentError) { state=this.#checked(identity)!;if(!state.fenced){state.observation.phase='failed';state.observation.failureCode=error.code;this.#write(state);await this.#storage.sync();} }
      }
    }
    state=this.#checked(identity)!;
    if (state.fenced && !this.#native.running && !state.observation.stop) {
      state.observation.stop={confirmationId:crypto.randomUUID(),observedAt:this.#clock(),nativeRunning:false,fenced:true};
      state.observation.phase='stopped'; state.observation.failureCode=null;
      this.#write(state); await this.#storage.sync();
    }
    return structuredClone(this.#checked(identity)!.observation);
  }
  async observe(identity: RuntimeIdentity): Promise<RuntimeObservation> { return this.#observe(identity,true); }
  async stop(identity: RuntimeIdentity): Promise<RuntimeObservation> {
    let state=this.#checked(identity) ?? this.#empty(identity);
    state.fenced=true; this.#write(state); await this.#storage.sync();
    try {
      if (this.#native.running) await this.#native.destroy();
      if (this.#native.running) throw Error('container-still-running');
      state=this.#checked(identity)!;
      if (!state.observation.stop) state.observation.stop={confirmationId:crypto.randomUUID(),observedAt:this.#clock(),nativeRunning:false,fenced:true};
      state.observation.phase='stopped'; state.observation.failureCode=null;
    } catch {
      state=this.#checked(identity)!; state.observation.phase='unknown'; state.observation.failureCode='stop-unknown'; state.observation.stop=null;
    }
    this.#write(state); await this.#storage.sync(); return structuredClone(state.observation);
  }
}
