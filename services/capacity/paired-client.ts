import type {TurnScope} from '../turn/protocol.ts';
import type {WorkspaceLeaseRef,TurnBinding,PairDomain,PairLease,PairSnapshot,QuiescenceProof,DomainReleaseProof} from './paired.ts';
import {TRUSTED_PI_CAPACITY_ACTOR} from './client.ts';
/** Versioned separate RPCs; never reinterpret an existing cold ticket. The
 * implementation must share cold's physical allocator actor and SQLite store. */
export interface WorkspacePairedCapacityPort{
 requestPair(scope:TurnScope,requestId:string):Promise<PairLease>;
 lookupPair(scope:TurnScope,requestId:string):Promise<PairLease|null>;
 bind(ref:WorkspaceLeaseRef,binding:TurnBinding):Promise<PairLease>;
 claimNativeStart(ref:WorkspaceLeaseRef,binding:TurnBinding,domain:PairDomain):Promise<{authorized:boolean;lease:PairLease}>;
 confirmHandoff(ref:WorkspaceLeaseRef,binding:TurnBinding,proofs:Record<PairDomain,QuiescenceProof>):Promise<PairLease>;
 cancelPair(ref:WorkspaceLeaseRef):Promise<PairLease>;
 confirmPairReleased(ref:WorkspaceLeaseRef,proofs:Partial<Record<PairDomain,DomainReleaseProof>>):Promise<PairLease>;
 maintainPairs():Promise<PairSnapshot>;
 pairedSnapshot():Promise<PairSnapshot>;
}
export function workspacePairedCapacityClient(namespace:{getByName(name:string):WorkspacePairedCapacityPort}):WorkspacePairedCapacityPort{
 if(!namespace?.getByName)throw Error('paired-capacity-namespace-required');return namespace.getByName(TRUSTED_PI_CAPACITY_ACTOR);
}
