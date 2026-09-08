import type { ProductModelProvider, ProductModelProviderInput, ProductModelProviderResult } from './http.ts';

export const OPENCODE_GO_RESPONSES_URL='https://opencode.ai/zen/go/v1/responses';
const MAX_DEFAULT_RESPONSE_BYTES=1_000_000,MAX_FRAME_BYTES=256*1024,encoder=new TextEncoder(),decoder=new TextDecoder('utf-8',{fatal:true}),EXTERNAL_ID=/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/,MODEL=/^[A-Za-z0-9][A-Za-z0-9._\/-]{0,149}$/;
type Options={model:string;credential:string;fetch?:typeof globalThis.fetch;clock?:()=>number;maxResponseBytes?:number};
function reject(code:string):never{throw Error(code);}
function integer(value:unknown,maximum=Number.MAX_SAFE_INTEGER,minimum=0):number{if(!Number.isSafeInteger(value)||(value as number)<minimum||(value as number)>maximum)reject('invalid-opencode-go-response');return value as number;}
function object(value:unknown):Record<string,unknown>{if(!value||typeof value!=='object'||Array.isArray(value)||Object.getPrototypeOf(value)!==Object.prototype)reject('invalid-opencode-go-response');return value as Record<string,unknown>;}
function externalId(value:unknown):string{if(typeof value!=='string'||!EXTERNAL_ID.test(value))reject('invalid-opencode-go-response');return value;}
async function readBounded(response:Response,maximum:number):Promise<Uint8Array>{
  if(!response.body)reject('opencode-go-response-body-required');const declared=response.headers.get('content-length');if(declared!==null&&(!/^\d+$/.test(declared)||Number(declared)>maximum))reject('opencode-go-response-too-large');
  const reader=response.body.getReader(),chunks:Uint8Array[]=[];let size=0;try{for(;;){const next=await reader.read();if(next.done)break;size+=next.value.byteLength;if(size>maximum)reject('opencode-go-response-too-large');chunks.push(next.value);}}catch(error){await reader.cancel().catch(()=>{});throw error;}
  if(size<1)reject('opencode-go-response-body-required');const joined=new Uint8Array(size);let offset=0;for(const chunk of chunks){joined.set(chunk,offset);offset+=chunk.byteLength;}return joined;
}
function usage(bytes:Uint8Array,inputBound:number,outputBound:number):{responseId:string;inputTokens:number;outputTokens:number}{
  let text:string;try{text=decoder.decode(bytes);}catch{reject('invalid-opencode-go-response');}const frames=text.replaceAll('\r\n','\n').split(/\n\n+/u);let terminal:{responseId:string;inputTokens:number;outputTokens:number}|null=null,afterTerminal=false;
  for(const frame of frames){if(!frame.trim())continue;if(encoder.encode(frame).byteLength>MAX_FRAME_BYTES)reject('opencode-go-response-frame-too-large');const values=frame.split('\n').filter(line=>line.startsWith('data:')).map(line=>line.slice(5).trimStart());if(!values.length)continue;const data=values.join('\n');if(data==='[DONE]'){afterTerminal=true;continue;}if(afterTerminal||terminal)reject('invalid-opencode-go-response');let event:unknown;try{event=JSON.parse(data);}catch{reject('invalid-opencode-go-response');}const row=object(event);if(row.type==='response.failed'||row.type==='error')reject('opencode-go-response-failed');if(row.type!=='response.completed'&&row.type!=='response.incomplete')continue;const response=object(row.response),evidence=object(response.usage),responseId=externalId(response.id),inputTokens=integer(evidence.input_tokens,inputBound),outputTokens=integer(evidence.output_tokens,outputBound);terminal={responseId,inputTokens,outputTokens};
  }
  if(!terminal)reject('opencode-go-response-evidence-required');return terminal;
}

/** Fixed OpenCode Go Responses adapter. It buffers a bounded SSE body so
 * provider usage and a correlation ID are verified before TenantModelBudget is
 * finalized, then returns the unchanged bytes to Pi. */
export class OpenCodeGoResponsesProvider implements ProductModelProvider{
  readonly #model:string;readonly #credential:string;readonly #fetch:typeof globalThis.fetch;readonly #clock:()=>number;readonly #maxResponseBytes:number;
  constructor(options:Options){
    if(!options||typeof options!=='object'||Array.isArray(options)||typeof options.model!=='string'||!MODEL.test(options.model)||typeof options.credential!=='string'||encoder.encode(options.credential).byteLength<16||encoder.encode(options.credential).byteLength>4096||(options.fetch!==undefined&&typeof options.fetch!=='function')||(options.clock!==undefined&&typeof options.clock!=='function'))reject('invalid-opencode-go-release');
    const maximum=options.maxResponseBytes??MAX_DEFAULT_RESPONSE_BYTES;if(!Number.isSafeInteger(maximum)||maximum<1024||maximum>1_100_000)reject('invalid-opencode-go-release');this.#model=options.model;this.#credential=options.credential;this.#fetch=options.fetch??globalThis.fetch;this.#clock=options.clock??Date.now;this.#maxResponseBytes=maximum;
  }
  async dispatch(input:ProductModelProviderInput):Promise<ProductModelProviderResult>{
    if(input.provider!=='opencode-go'||input.model!==this.#model||!EXTERNAL_ID.test(input.idempotencyKey)||!Number.isSafeInteger(input.maxOutputTokens)||input.maxOutputTokens<16||input.maxOutputTokens>131_072||!Number.isSafeInteger(input.deadlineAt)||input.deadlineAt<=this.#clock())reject('opencode-go-request-denied');
    const payload=object(input.payload);for(const key of ['model','max_output_tokens','provider','apiKey','api_key','authorization','baseURL','base_url'])if(Object.hasOwn(payload,key))reject('opencode-go-request-denied');if(payload.stream!==true||payload.store!==false)reject('opencode-go-request-denied');
    const body=JSON.stringify({...payload,model:this.#model,max_output_tokens:input.maxOutputTokens}),controller=new AbortController(),delay=input.deadlineAt-this.#clock(),timer=setTimeout(()=>controller.abort(new DOMException('Provider deadline exceeded','TimeoutError')),delay),signal=input.signal?AbortSignal.any([input.signal,controller.signal]):controller.signal;
    let response:Response,bytes:Uint8Array;try{response=await this.#fetch(OPENCODE_GO_RESPONSES_URL,{method:'POST',redirect:'manual',headers:{'content-type':'application/json','accept':'text/event-stream','authorization':`Bearer ${this.#credential}`,'x-client-request-id':input.idempotencyKey},body,signal});bytes=await readBounded(response,this.#maxResponseBytes);}finally{clearTimeout(timer);}
    const headerId=response.headers.get('x-request-id');
    if(response.status<200||response.status>=300){const generic=encoder.encode(JSON.stringify({error:'provider_rejected',status:response.status}));return {status:response.status,providerRequestId:headerId&&EXTERNAL_ID.test(headerId)?headerId:null,inputTokens:null,outputTokens:null,responseContentType:'application/json',responseBody:generic};}
    if(response.headers.get('content-type')?.split(';')[0].trim()!=='text/event-stream')reject('opencode-go-response-content-type');const evidence=usage(bytes,input.inputTokenUpperBound,input.maxOutputTokens),providerRequestId=headerId&&EXTERNAL_ID.test(headerId)?headerId:evidence.responseId;
    return {status:response.status,providerRequestId,inputTokens:evidence.inputTokens,outputTokens:evidence.outputTokens,responseContentType:'text/event-stream',responseBody:bytes};
  }
}

export const openCodeGoResponsesLimits={maxDefaultResponseBytes:MAX_DEFAULT_RESPONSE_BYTES,maxFrameBytes:MAX_FRAME_BYTES};
