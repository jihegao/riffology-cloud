import { DurableObject } from 'cloudflare:workers';
import { catalogDatabase } from '../catalog/database.ts';
import { ProvisioningCatalog } from '../catalog/provisioning.ts';
import { TenantQuota, tenantQuotaName } from '../quota/durable.ts';
import { RuntimeCore, type NativeRuntimePort } from './core.ts';
import { R2ModelContentPort, type VerifiedModelContent } from './content.ts';
import { INSPECT_INITIAL_FILES, INSTALL_MODEL_CONTENT } from './starter.ts';
import { canonicalWorkspaceMarker, type RuntimeIdentity, type RuntimeInitialize } from '../workspace/protocol.ts';

export interface ProjectRuntimeEnv {
  PROJECT_RUNTIME: DurableObjectNamespace<ProjectRuntime>;
  TENANT_QUOTA: DurableObjectNamespace<TenantQuota>;
  CATALOG: D1Database;
  WORKSPACE_CHECKPOINTS: R2Bucket;
  /** Private platform model package namespace; never exposed to Pi/client. */
  MODEL_CONTENT: R2Bucket;
}
const encoder=new TextEncoder();
function byteStream(parts:Uint8Array[]):ReadableStream {
  let index=0;
  return new ReadableStream({pull(controller){
    const part=parts[index++];if(part)controller.enqueue(part);else controller.close();
  }});
}
function modelContentInput(content:VerifiedModelContent):ReadableStream {
  const header=encoder.encode(`${JSON.stringify(content.manifest)}\n`);
  return byteStream([header,...content.manifest.files.map(file=>content.files[file.path]!)]);
}
function manifestInput(content:VerifiedModelContent['manifest']|undefined):ReadableStream {
  return byteStream([encoder.encode(JSON.stringify(content??null))]);
}
/** No public fetch endpoint and no provider secrets in the container. */
export class ProjectRuntime extends DurableObject<ProjectRuntimeEnv> {
  #core: RuntimeCore | null=null;
  #for(identity: RuntimeIdentity): RuntimeCore {
    canonicalWorkspaceMarker(identity,'validation');
    if (!this.env.PROJECT_RUNTIME.idFromName(identity.runtimeId).equals(this.ctx.id)) throw Error('runtime-actor-scope-denied');
    if (!this.#core) {
      const container=this.ctx.container;
      if (!container) throw Error('container-not-configured');
      const context=this.ctx;
      const native: NativeRuntimePort={
        get running(){return container.running;},
        start(program){
          container.start({entrypoint:['node','-e',program],enableInternet:false});
          context.waitUntil(container.monitor().catch(()=>{}));
        },
        async installContent(content){
          const process=await container.exec(['node','-e',INSTALL_MODEL_CONTENT],{
            stdin:modelContentInput(content),stdout:'ignore',stderr:'ignore',signal:AbortSignal.timeout(30000),
          });
          if(await process.exitCode!==0)throw Error('model-content-install-failed');
        },
        async inspectFiles(content){
          if (!container.running) return null;
          let expired=false, process:ExecProcess|null=null;
          let reader:ReadableStreamDefaultReader<Uint8Array>|null=null;
          const cleanup=()=>{try{process?.kill(9);}catch{/* stop remains unconfirmed */}void reader?.cancel().catch(()=>{});};
          const actual=(async()=>{
            process=await container.exec(['node','-e',INSPECT_INITIAL_FILES],{stdin:manifestInput(content),stdout:'pipe',stderr:'ignore',signal:AbortSignal.timeout(5000)});
            if(expired){cleanup();throw Error('runtime-observation-deadline');}
            reader=process.stdout?.getReader()??null;if(!reader)return null;
            const parts:Uint8Array[]=[];let size=0;
            try{
              for(;;){const part=await reader.read();if(part.done)break;size+=part.value.byteLength;
                if(size>16384){cleanup();throw Error('runtime-output-limit');}parts.push(part.value);}
              if(await process.exitCode!==0)return null;
              if(expired)throw Error('runtime-observation-deadline');
              const bytes=new Uint8Array(size);let offset=0;for(const part of parts){bytes.set(part,offset);offset+=part.length;}
              return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes)) as Record<string,string>;
            }finally{void reader.cancel().catch(()=>{});reader.releaseLock();}
          })();
          context.waitUntil(actual.catch(()=>{}));
          let timer:ReturnType<typeof setTimeout>|undefined;
          try{return await Promise.race([actual,new Promise<never>((_resolve,reject)=>{
            timer=setTimeout(()=>{expired=true;cleanup();reject(Error('runtime-observation-deadline'));},5000);
          })]);}finally{if(timer!==undefined)clearTimeout(timer);}
        },
        async destroy(){await container.destroy();},
      };
      const bucket=this.env.WORKSPACE_CHECKPOINTS;
      this.#core=new RuntimeCore(this.ctx.storage,native,{
        async read(key){const value=await bucket.get(key);if(!value)return null;if(value.size>16384){void value.body.cancel();throw Error('checkpoint-size-limit');}return value.text();},
        async putOnce(key,value){await bucket.put(key,value,{onlyIf:{etagDoesNotMatch:'*'},httpMetadata:{contentType:'application/json'}});},
      },{
        verifyTask:task=>new ProvisioningCatalog(catalogDatabase(this.env.CATALOG)).verifyTask(task),
        lookup:(tenantId,operationId)=>this.env.TENANT_QUOTA.getByName(tenantQuotaName(tenantId)).lookup(tenantId,operationId),
      },()=>Date.now(),new R2ModelContentPort(this.env.MODEL_CONTENT));
    }
    return this.#core;
  }
  async initialize(input:RuntimeInitialize){return this.#for(input.identity).initialize(input);}
  async observe(identity:RuntimeIdentity){return this.#for(identity).observe(identity);}
  async stop(identity:RuntimeIdentity){return this.#for(identity).stop(identity);}
}
