import {createHash} from 'node:crypto';

const SHA=/^[a-f0-9]{64}$/;
const ID=/^[A-Za-z0-9_-]{1,128}$/;
const CATEGORIES=new Set(['create-model','parameter-change','mechanism-change','repair-validation','measured-evidence','reopen-continue']);
const RELATIONS={
 'create-model':'created',
 'parameter-change':'unchanged',
 'mechanism-change':'changed',
 'repair-validation':'restored-from-seeded-failure',
 'measured-evidence':'unchanged',
 'reopen-continue':'changed',
};
const hash=value=>createHash('sha256').update(typeof value==='string'||Buffer.isBuffer(value)?value:JSON.stringify(value)).digest('hex');
const exact=(value,keys)=>!!value&&typeof value==='object'&&!Array.isArray(value)&&Object.getPrototypeOf(value)===Object.prototype&&Object.keys(value).sort().join(',')===[...keys].sort().join(',');
const id=(value,code)=>{if(typeof value!=='string'||!ID.test(value))throw Error(code);return value;};
const sha=(value,code)=>{if(typeof value!=='string'||!SHA.test(value))throw Error(code);return value;};
const nullableId=(value,code)=>value===null?null:id(value,code);
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);

function version(raw,code='g5-fixture-source-invalid'){
 if(!exact(raw,['revisionId','filesSha256','specSha256']))throw Error(code);
 return {revisionId:nullableId(raw.revisionId,code),filesSha256:sha(raw.filesSha256,code),specSha256:sha(raw.specSha256,code)};
}
function reference(raw,code){
 if(!exact(raw,['kind','id','sha256'])||!['turn','revision','run','group','artifact','evidence','tool-event'].includes(raw.kind))throw Error(code);
 return {kind:raw.kind,id:id(raw.id,code),sha256:raw.sha256===null?null:sha(raw.sha256,code)};
}
function assertions(raw,expected,code){
 if(!Array.isArray(raw)||raw.length!==expected.length)throw Error(code);
 return expected.map(name=>{const matches=raw.filter(item=>item?.name===name);if(matches.length!==1||!exact(matches[0],['name','satisfied','references'])||matches[0].satisfied!==true||!Array.isArray(matches[0].references)||matches[0].references.length===0)throw Error(code);return {name,references:matches[0].references.map(item=>reference(item,code)),satisfied:true};});
}
function taskValue(task){
 if(!task||!CATEGORIES.has(task.id)||typeof task.fixtureId!=='string'||!ID.test(task.fixtureId)||!Number.isSafeInteger(task.repeat)||task.repeat<1||task.repeat>3||!Number.isSafeInteger(task.sequence)||task.sequence<1||task.sequence>6||task.dependsOn!==null&&(!ID.test(task.dependsOn)||task.sequence===1)||!Array.isArray(task.requiredEvidence)||!task.requiredEvidence.length||task.requiredEvidence.some(v=>typeof v!=='string'||!v)||!Array.isArray(task.domainChecks)||!task.domainChecks.length||task.domainChecks.some(v=>typeof v!=='string'||!v))throw Error('g5-fixture-task-invalid');
 return task;
}

export function seededFailureArchitectureAudit(){
 return Object.freeze({schemaVersion:1,supported:false,authorized:false,code:'g5-seeded-failure-authority-not-implemented',missing:Object.freeze([
  'private operator admission bound to the active G5 A window and counted task',
  'authoritative operator Turn lifecycle with runtime-free resource disposition',
  'Python compile validator that persists a failed diagnostic artifact',
  'atomic RevisionStore checkpoint plus Workspace TurnJournal current-head acknowledgement',
  'operator mutation settlement in the G5 task and tool ledgers',
 ]),options:Object.freeze([
  Object.freeze({id:'A',kind:'first-class-operator-task',normalTasks:64,maximumProbes:2,requiresFixtureRefreeze:false}),
  Object.freeze({id:'B',kind:'same-repair-turn-tool-sandbox',normalTasks:63,maximumProbes:3,requiresFixtureRefreeze:true}),
 ])});
}

export function createSeededFailureOperatorIntent({windowId,fixture,scope,sessionId,currentVersion,asset,predecessorAuthorityReceiptSha256}){
 const task=taskValue(fixture);if(task.id!=='repair-validation'||task.seededFailure!=='seededFailure')throw Error('g5-seeded-failure-task-invalid');
 if(!exact(scope,['tenantId','projectId','workspaceId','workspaceGeneration'])||!Number.isSafeInteger(scope.workspaceGeneration)||scope.workspaceGeneration<1)throw Error('g5-seeded-failure-scope-invalid');
 const normalizedScope={tenantId:id(scope.tenantId,'g5-seeded-failure-scope-invalid'),projectId:id(scope.projectId,'g5-seeded-failure-scope-invalid'),workspaceId:id(scope.workspaceId,'g5-seeded-failure-scope-invalid'),workspaceGeneration:scope.workspaceGeneration};
 if(!exact(asset,['kind','path','sha256','byteLength','base64','expected','repair'])||asset.kind!=='deliberate-python-syntax-failure'||asset.path!=='model/model.py'||!Number.isSafeInteger(asset.byteLength)||asset.byteLength<1||asset.byteLength>1024*1024||asset.expected?.phase!=='Python compile validation'||asset.expected?.exception!=='SyntaxError'||asset.expected?.cause!=='missing-colon-after-run-definition'||asset.repair?.asset!=='abandonment'||asset.repair?.path!=='model/model.py')throw Error('g5-seeded-failure-asset-invalid');
 let bytes;try{bytes=Buffer.from(asset.base64,'base64');}catch{throw Error('g5-seeded-failure-asset-invalid');}
 if(bytes.toString('base64')!==asset.base64||bytes.byteLength!==asset.byteLength||hash(bytes)!==asset.sha256||!SHA.test(asset.repair.sha256))throw Error('g5-seeded-failure-asset-invalid');
 return {schemaVersion:1,purpose:'g5-a-seeded-failure-injection',windowId:id(windowId,'g5-seeded-failure-window-invalid'),fixtureId:task.fixtureId,scope:normalizedScope,sessionId:id(sessionId,'g5-seeded-failure-session-invalid'),expectedCurrentHead:version(currentVersion,'g5-seeded-failure-head-invalid'),predecessorAuthorityReceiptSha256:sha(predecessorAuthorityReceiptSha256,'g5-seeded-failure-predecessor-invalid'),mutation:{path:asset.path,bytesBase64:asset.base64,bytes:asset.byteLength,sha256:asset.sha256},expectedFailure:{phase:'Python compile validation',exception:'SyntaxError',cause:'missing-colon-after-run-definition'},expectedRepairSha256:asset.repair.sha256};
}

export function validateSeededFailureOperatorReceipt(raw,intent){
 if(!exact(raw,['schemaVersion','purpose','windowId','fixtureId','scope','sessionId','baseHead','injectedHead','mutation','validationArtifact','taskReceiptSha256','receiptSha256'])||raw.schemaVersion!==1||raw.purpose!==intent.purpose||raw.windowId!==intent.windowId||raw.fixtureId!==intent.fixtureId||raw.sessionId!==intent.sessionId||!same(raw.scope,intent.scope)||!same(raw.baseHead,intent.expectedCurrentHead)||!same(raw.mutation,intent.mutation))throw Error('g5-seeded-failure-receipt-invalid');
 const injected=version(raw.injectedHead,'g5-seeded-failure-receipt-invalid');if(injected.revisionId===null||injected.revisionId===intent.expectedCurrentHead.revisionId||injected.filesSha256===intent.expectedCurrentHead.filesSha256||injected.specSha256!==intent.expectedCurrentHead.specSha256)throw Error('g5-seeded-failure-receipt-invalid');
 const artifact=raw.validationArtifact;if(!exact(artifact,['artifactId','artifactSha256','sourceSha256','revisionId','outcome','phase','exception','cause'])||artifact.outcome!=='failed'||artifact.phase!==intent.expectedFailure.phase||artifact.exception!==intent.expectedFailure.exception||artifact.cause!==intent.expectedFailure.cause||artifact.sourceSha256!==intent.mutation.sha256||artifact.revisionId!==injected.revisionId)throw Error('g5-seeded-failure-artifact-invalid');
 id(artifact.artifactId,'g5-seeded-failure-artifact-invalid');sha(artifact.artifactSha256,'g5-seeded-failure-artifact-invalid');sha(raw.taskReceiptSha256,'g5-seeded-failure-receipt-invalid');sha(raw.receiptSha256,'g5-seeded-failure-receipt-invalid');return structuredClone(raw);
}

export class G5FixtureAuthorityAdapter{
 #fixtures;#port;#accepted=new Map();#failure=new Map();#nextIndex=0;
 constructor({fixtures,port}){if(!fixtures?.sequence||fixtures.sequence.length!==18||!port||typeof port.inspectFixtureTask!=='function')throw Error('g5-fixture-authority-port-required');this.#fixtures=fixtures;this.#port=port;}
 recordSeededFailure(task,receipt,{windowId,scope,sessionId,currentVersion}){const checkedTask=taskValue(task);if(checkedTask.id!=='repair-validation')throw Error('g5-seeded-failure-task-invalid');const prior=this.#accepted.get(checkedTask.dependsOn);if(!prior)throw Error('g5-fixture-predecessor-missing');const head=version(currentVersion,'g5-seeded-failure-head-invalid');if(!same(head,prior.source))throw Error('g5-seeded-failure-head-invalid');const intent=createSeededFailureOperatorIntent({windowId,fixture:checkedTask,scope,sessionId,currentVersion:head,asset:this.#fixtures.assets.seededFailure,predecessorAuthorityReceiptSha256:prior.receiptSha256});const checked=validateSeededFailureOperatorReceipt(receipt,intent);this.#failure.set(checkedTask.fixtureId,checked);return checked;}
 async inspect({task,workspaceId,sessionId,turnId,version:rawVersion}){
  const checkedTask=taskValue(task),expected=this.#fixtures.sequence[this.#nextIndex];if(expected?.fixtureId!==checkedTask.fixtureId)throw Error('g5-fixture-order-invalid');const actual=version(rawVersion),prior=checkedTask.dependsOn?this.#accepted.get(checkedTask.dependsOn):null;if(checkedTask.dependsOn&&!prior)throw Error('g5-fixture-predecessor-missing');
  const failure=this.#failure.get(checkedTask.fixtureId)??null;if(checkedTask.id==='repair-validation'&&!failure)throw Error('g5-seeded-failure-proof-required');if(checkedTask.id!=='repair-validation'&&failure)throw Error('g5-seeded-failure-proof-unexpected');
  const relation=RELATIONS[checkedTask.id],previous=prior?.source??null;
  if(relation==='unchanged'&&(!previous||previous.filesSha256!==actual.filesSha256||previous.specSha256!==actual.specSha256))throw Error('g5-fixture-source-relation-invalid');
  if(relation==='changed'&&(!previous||previous.filesSha256===actual.filesSha256||previous.revisionId===actual.revisionId))throw Error('g5-fixture-source-relation-invalid');
  if(relation==='created'&&(previous||actual.revisionId===null))throw Error('g5-fixture-source-relation-invalid');
  if(relation==='restored-from-seeded-failure'&&(actual.revisionId===null||actual.revisionId===failure.injectedHead.revisionId||actual.filesSha256===failure.injectedHead.filesSha256))throw Error('g5-fixture-source-relation-invalid');
  const intent={schemaVersion:1,fixtureId:checkedTask.fixtureId,category:checkedTask.id,repeat:checkedTask.repeat,sequence:checkedTask.sequence,dependsOn:prior?{fixtureId:checkedTask.dependsOn,receiptSha256:prior.receiptSha256}:null,workspaceId:id(workspaceId,'g5-fixture-context-invalid'),sessionId:id(sessionId,'g5-fixture-context-invalid'),turnId:id(turnId,'g5-fixture-context-invalid'),source:actual,sourceRelation:relation,requiredEvidence:[...checkedTask.requiredEvidence],domainChecks:[...checkedTask.domainChecks],seededFailure:failure?{injectedHead:failure.injectedHead,validationArtifact:failure.validationArtifact,receiptSha256:failure.receiptSha256}:null};
  const raw=await this.#port.inspectFixtureTask(structuredClone(intent));const receipt=this.#receipt(raw,intent);this.#accepted.set(checkedTask.fixtureId,receipt);this.#nextIndex++;return receipt;
 }
 #receipt(raw,intent){
  if(!exact(raw,['schemaVersion','fixtureId','category','dependsOn','workspaceId','sessionId','turnId','source','sourceRelation','requiredEvidence','domainChecks','seededFailureReceiptSha256','receiptSha256'])||raw.schemaVersion!==1||raw.fixtureId!==intent.fixtureId||raw.category!==intent.category||raw.workspaceId!==intent.workspaceId||raw.sessionId!==intent.sessionId||raw.turnId!==intent.turnId||raw.sourceRelation!==intent.sourceRelation||!same(raw.dependsOn,intent.dependsOn)||!same(version(raw.source),intent.source))throw Error('g5-fixture-authority-receipt-invalid');
  const expectedFailure=intent.seededFailure?.receiptSha256??null;if(raw.seededFailureReceiptSha256!==expectedFailure)throw Error('g5-fixture-authority-receipt-invalid');const receipt={...raw,source:version(raw.source),requiredEvidence:assertions(raw.requiredEvidence,intent.requiredEvidence,'g5-fixture-required-evidence-invalid'),domainChecks:assertions(raw.domainChecks,intent.domainChecks,'g5-fixture-domain-check-invalid'),receiptSha256:sha(raw.receiptSha256,'g5-fixture-authority-receipt-invalid')};return structuredClone(receipt);
 }
}
