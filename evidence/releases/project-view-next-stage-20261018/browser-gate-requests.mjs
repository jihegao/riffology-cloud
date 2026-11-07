// Pure request construction. No network, auth, filesystem, retry or sender.
import {createHash} from 'node:crypto';
import {parseProjectViewBrowserPolicy} from '../content-v2/services/project-views/browser-policy.ts';
import {scope,actor,sameScope} from '../content-v2/services/turn/protocol.ts';

const ACCOUNT='8b0d70250211aa10d89e20605a1c7e5e',WORKER='riffology-m1-gateway-staging';
const KEY='PROJECT_VIEW_BROWSER_POLICY_JSON',SOURCE='9c8e4b6b763e9887d1624f00ed3a8efb2a8a24d984d96bc68fdb289cb4d362c3';
const HUMAN_LIMIT=Date.parse('2026-10-20T15:59:59.999Z'),FOUR_HOURS=4*60*60*1000;
const BASE={bindings:106,secrets:11,exports:25,containerAssociations:6,assets:96,apps:16,namespaces:50};
const deny=()=>{throw Error('browser-gate-pending-or-conflict');};
const equal=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const sha=value=>createHash('sha256').update(value).digest('hex');
function exact(value,keys){if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).sort().join()!==[...keys].sort().join())deny();}
function id(value){if(typeof value!=='string'||!/^[A-Za-z0-9_-]{1,128}$/.test(value))deny();return value;}
function hash(value){if(typeof value!=='string'||!/^[a-f0-9]{64}$/.test(value))deny();}
function time(value){if(!Number.isSafeInteger(value)||value<1)deny();}
function checked(plan,witness,now,opened){
 exact(plan,['requestId','accountId','worker','sourceSha256','expectedVersionId','stableMetadataSha256','controlPlaneSha256','humanGrant','policy','identity']);
 id(plan.requestId);id(plan.expectedVersionId);hash(plan.stableMetadataSha256);hash(plan.controlPlaneSha256);time(now);
 if(plan.accountId!==ACCOUNT||plan.worker!==WORKER||plan.sourceSha256!==SOURCE)deny();
 const grant=plan.humanGrant;exact(grant,['authorizationRef','startsAt','endsAt','dataEgress']);id(grant.authorizationRef);time(grant.startsAt);time(grant.endsAt);
 if(grant.dataEgress!=='accepted'||grant.endsAt<=grant.startsAt||grant.endsAt>HUMAN_LIMIT||now<grant.startsAt||now>=grant.endsAt)deny();
 const policy=parseProjectViewBrowserPolicy(JSON.stringify(plan.policy));
 if(!policy||policy.enabled!==true||policy.grants.length!==1||policy.endsAt-policy.startsAt>FOUR_HOURS||policy.startsAt<grant.startsAt||policy.endsAt>grant.endsAt||policy.endsAt>HUMAN_LIMIT||(!opened&&now>=policy.endsAt)||now<policy.startsAt)deny();
 const i=plan.identity;exact(i,['createScope','r2Scope','meActor','sqlScope','sqlActor','receiptSha256s','checkedAt']);time(i.checkedAt);
 exact(i.receiptSha256s,['create','r2','me','sql']);Object.values(i.receiptSha256s).forEach(hash);
 const original=scope(i.createScope),r2=scope(i.r2Scope),sql=scope(i.sqlScope),me=actor(i.meActor),sqlActor=actor(i.sqlActor),wanted=policy.grants[0];
 if(!sameScope(original,r2)||!sameScope(original,sql)||!sameScope(original,wanted.scope)||!equal(me,sqlActor)||!equal(me,wanted.actor)||i.checkedAt<grant.startsAt||i.checkedAt>now)deny();
 exact(witness,['latestVersionId','deployments','sourceSha256','stableMetadataSha256','controlPlaneSha256','gateBindingType','counts','actor','checkedAt']);time(witness.checkedAt);
 exact(witness.counts,Object.keys(BASE));
 const expected={...BASE,bindings:BASE.bindings+(opened?1:0),secrets:BASE.secrets+(opened?1:0)};
 if(Object.keys(BASE).some(k=>witness.counts[k]!==expected[k])||witness.gateBindingType!==(opened?'secret_text':'absent'))deny();
 if(witness.sourceSha256!==SOURCE||witness.stableMetadataSha256!==plan.stableMetadataSha256||witness.controlPlaneSha256!==plan.controlPlaneSha256||!equal(actor(witness.actor),me)||witness.checkedAt<i.checkedAt||witness.checkedAt>now)deny();
 if(!Array.isArray(witness.deployments)||witness.deployments.length!==1)deny();exact(witness.deployments[0],['versionId','percentage']);
 if(witness.latestVersionId!==witness.deployments[0].versionId||witness.deployments[0].percentage!==100)deny();
 return {policy,me};
}
function body(policy){return {name:KEY,type:'secret_text',text:JSON.stringify(policy)};}
const path=`/accounts/${ACCOUNT}/workers/scripts/${WORKER}/secrets`;

export function openRequest(plan,witness,now){
 const {policy}=checked(plan,witness,now,false);
 if(witness.latestVersionId!==plan.expectedVersionId)deny();
 return {method:'PUT',path,headers:{'content-type':'application/json'},body:body(policy)};
}
export function closeRequest(plan,witness,ownOpen,now){
 const {policy,me}=checked(plan,witness,now,true);
 exact(ownOpen,['requestId','versionId','actor','bodySha256','acknowledged']);id(ownOpen.versionId);
 if(ownOpen.acknowledged!==true||ownOpen.requestId!==plan.requestId||!equal(actor(ownOpen.actor),me)||ownOpen.bodySha256!==sha(JSON.stringify(body(policy)))||witness.latestVersionId!==ownOpen.versionId||ownOpen.versionId===plan.expectedVersionId)deny();
 return {method:'DELETE',path:path+'/'+KEY};
}
