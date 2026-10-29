/** Resume only a proven original PUT; never uploads or sends a replacement. */
import {readFile,lstat} from 'node:fs/promises';
import {guard,sha,apiEnvelope} from './io-boundary.mjs';
import {hashJSON} from './a2/ir-publication-candidate.mjs';
import {buildGatewayMetadata} from './gateway-metadata.mjs';
import {assertGatewayReadback} from './gateway-readback.mjs';
import {preservationProjection} from './collect-baseline.mjs';
import {PUT,WORKER} from './fixed-target.mjs';
async function pinned(ref){guard(typeof ref?.file==='string'&&ref.file.startsWith('/')&&Number.isSafeInteger(ref.bytes)&&/^[a-f0-9]{64}$/.test(ref.sha256??''),'resume-reference');const s=await lstat(ref.file);guard(s.isFile()&&!s.isSymbolicLink()&&s.size===ref.bytes&&s.size<=64*1024*1024,'resume-regular-file');const b=await readFile(ref.file);guard(b.length===ref.bytes&&sha(b)===ref.sha256,'resume-evidence-drift');return b;}
export async function reconcileGateway(facts,closure,current){
 const r=facts.gatewayResume;guard(r?.schema==='riffoid-ir-known-gateway-resume/v1','known-gateway-resume-required');
 const before=JSON.parse(await pinned(r.before)),intent=JSON.parse(await pinned(r.intent)),ack=JSON.parse(await pinned(r.ack)),response=await pinned(r.response),binding=JSON.parse(await pinned(r.multipartBinding));
 guard(intent.schema==='riffoid-ir-original-write-intent/v1'&&intent.requestId===facts.requestId&&intent.method==='PUT'&&intent.path===PUT&&intent.credentialKind==='oauth','resume-original-put-intent');
 guard(ack.schema==='riffoid-ir-known-original-ack/v1'&&ack.requestId===facts.requestId&&ack.intentSha256===r.intent.sha256&&ack.status===200&&ack.responseBytes===response.length&&ack.responseSha256===sha(response)&&ack.resultId===WORKER,'resume-complete-original-ack');
 guard(binding.requestId===facts.requestId&&binding.bodySha256===intent.bodySha256&&binding.bodyBytes===intent.bodyBytes&&binding.moduleSha256===sha(closure.module),'resume-original-module-body');
 guard(hashJSON(preservationProjection(current))===facts.baselineProjectionSha256,'resume-current-preservation-drift');
 const metadata=buildGatewayMetadata(before,{tag:'ir-m3-m4-'+facts.requestId,message:facts.releaseMessage,baselineProjectionSha256:hashJSON(preservationProjection(before))});
 guard(binding.metadataWithoutCompletionCanonicalSha256===hashJSON(metadata),'resume-original-metadata');
 const originalAck={result:apiEnvelope({body:response}).result,ack:r.ack,acknowledgedAt:ack.acknowledgedAt,intent:r.intent,originalRequest:{requestId:facts.requestId,method:'PUT',path:PUT,bodySha256:intent.bodySha256,bodyBytes:intent.bodyBytes},responseSha256:sha(response),responseStatus:200};
 const delta=assertGatewayReadback(before,current,{expectedMetadata:metadata,expectedModule:{mainModule:'index.js',bytes:closure.module.length,sha256:sha(closure.module)},originalAck,requestId:facts.requestId,expectedMultipartSha256:intent.bodySha256});
 return {originalAck,delta};
}
