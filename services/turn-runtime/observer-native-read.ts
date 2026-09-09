import { TRUSTED_PI_CONTROL_ROOT, type TrustedPiSandboxProcessApi, type TrustedPiProcessView } from './pi-native.ts';

export type ObserverRunningContainer={readonly running:boolean;getTcpPort(port:number):{fetch(request:Request):Promise<Response>}};
const encoder=new TextEncoder(),decoder=new TextDecoder('utf-8',{fatal:true});
const filePattern=new RegExp(`^${TRUSTED_PI_CONTROL_ROOT}/[a-f0-9]{52}\\.(control|result)\\.json$`);
function deny():never{throw Error('trusted-pi-observer-read-denied');}
function object(value:unknown):value is Record<string,unknown>{return !!value&&typeof value==='object'&&!Array.isArray(value);}

/** Private daemon protocol pinned to @cloudflare/sandbox 0.12.9, upstream tag
 * 133939602f28a23ae6bab1d00878d95b3f308394. POST /api/read uses the explicit
 * sessionless token; GET /api/process/:id is sandbox-scoped. No SDK client,
 * containerFetch, start, session initialization, redirects or retries are used.
 * The owning RPC must first validate the derived Sandbox actor identity.
 * Sandbox/Container constructor bookkeeping remains separate (table/alarm
 * initialization). The daemon can perform MIME detection; this reader does
 * not claim zero daemon helper processes or native-container validation. */
export function createObserverNativeReader(container:ObserverRunningContainer|undefined,deadlineAt:number,clock:()=>number=Date.now):Pick<TrustedPiSandboxProcessApi,'readFile'|'getProcess'>{
  if(!Number.isSafeInteger(deadlineAt)||deadlineAt<=clock()||deadlineAt>clock()+15000)deny();
  const check=()=>{if(!container?.running||clock()>=deadlineAt)deny();};
  async function request(path:string,body:unknown,max:number):Promise<unknown>{
    check();
    const controller=new AbortController();let reader:ReadableStreamDefaultReader<Uint8Array>|undefined;
    const expired=new Promise<never>((_,reject)=>controller.signal.addEventListener('abort',()=>reject(Error('trusted-pi-observer-read-expired')),{once:true}));
    // A synchronous getTcpPort/fetch failure can precede the first race.
    void expired.catch(()=>{});
    const timer=setTimeout(()=>controller.abort(),Math.max(1,deadlineAt-clock()));
    try{
      const req=new Request(`http://localhost:3000${path}`,{method:body===undefined?'GET':'POST',redirect:'manual',headers:body===undefined?{}:{'Content-Type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)}),signal:controller.signal});
      check();
      const pending=container!.getTcpPort(3000).fetch(req).then(response=>{if(controller.signal.aborted||!container!.running||clock()>=deadlineAt){void response.body?.cancel().catch(()=>{});deny();}return response;});
      const response=await Promise.race([pending,expired]);check();
      if(response.status!==200){void response.body?.cancel().catch(()=>{});if(response.status===404)throw Error('trusted-pi-observer-read-404');deny();}
      if(!response.body)deny();
      reader=response.body.getReader();const chunks:Uint8Array[]=[];let total=0,count=0;
      while(true){check();const part=await Promise.race([reader.read(),expired]);check();if(part.done)break;if(++count>4096||(total+=part.value.byteLength)>max)deny();chunks.push(part.value);}
      const bytes=new Uint8Array(total);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}
      const value:unknown=JSON.parse(decoder.decode(bytes));check();return value;
    }finally{clearTimeout(timer);controller.abort();if(reader)void reader.cancel().catch(()=>{});}
  }
  async function getProcess(id:string):Promise<TrustedPiProcessView|null>{
    if(typeof id!=='string'||!/^pi-[a-f0-9]{52}$/.test(id)||id.length!==55)deny();
    let value:unknown;try{value=await request(`/api/process/${id}`,undefined,64*1024);}catch(error){if(error instanceof Error&&error.message==='trusted-pi-observer-read-404')return null;throw error;}
    check();
    if(!object(value)||value.success!==true||!object(value.process))deny();const p=value.process;
    if(p.id!==id||typeof p.status!=='string'||!['starting','running','completed','failed','killed','error'].includes(p.status)||(p.exitCode!==undefined&&p.exitCode!==null&&!Number.isSafeInteger(p.exitCode)))deny();
    check();return {id,status:p.status,...(typeof p.exitCode==='number'?{exitCode:p.exitCode}:{}),async getStatus(){return (await getProcess(id))?.status??'error';},async kill(){deny();}};
  }
  return {
    async readFile(path,options){
      const match=typeof path==='string'?filePattern.exec(path):null;
      if(!match||match[0]!==path||options?.encoding!==undefined&&options.encoding!=='utf8')deny();
      const max=match[1]==='control'?64*1024:2*1024*1024;
      // JSON escaping can expand one content byte into six wire bytes.
      const value=await request('/api/read',{path,sessionId:'__DISABLE_SESSION__',encoding:'utf8'},max*6+64*1024);
      check();
      if(!object(value)||value.success!==true||value.path!==path||typeof value.content!=='string'||encoder.encode(value.content).byteLength>max)deny();
      check();return {success:true,path,content:value.content};
    },getProcess
  };
}
