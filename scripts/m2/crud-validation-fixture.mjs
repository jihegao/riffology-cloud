/** Deterministic provider wire fixture. No network, credential, or filesystem access.
 * Only the test release installs this adapter; real Pi dispatches all tool calls. */
export const crudExpectedFiles = Object.freeze({
  'model/renamed-1.txt': 'value-1-edited\n',
  'model/renamed-2.txt': 'value-2-edited\n',
  'model/renamed-3.txt': 'value-3-edited\n',
  'model/renamed-4.txt': 'value-4-edited\n',
});
export const crudMutationCalls = Object.freeze([
  ...Array.from({length:8},(_,i)=>({name:'project_write',args:{path:`model/file-${i+1}.txt`,content:`value-${i+1}\n`}})),
  ...Array.from({length:4},(_,i)=>({name:'project_edit',args:{path:`model/file-${i+1}.txt`,oldText:`value-${i+1}`,newText:`value-${i+1}-edited`,replaceAll:false}})),
  ...Array.from({length:4},(_,i)=>({name:'project_bash',args:{script:`mv model/file-${i+1}.txt model/renamed-${i+1}.txt`,timeoutMs:5000}})),
  ...Array.from({length:4},(_,i)=>({name:'project_bash',args:{script:`rm model/file-${i+5}.txt`,timeoutMs:5000}})),
]);
export const crudRecoveryCalls = Object.freeze(Object.keys(crudExpectedFiles).map(path=>({name:'project_read',args:{path}})));
export function createCrudFixtureFetch(modelId) {
  return async function fixtureFetch(input,init) {
    const request=new Request(input,init);
    if(request.method!=='POST'||!request.url.endsWith('/chat/completions'))throw Error('crud-fixture-unexpected-request');
    const payload=await request.json();
    if(payload.model!==modelId||payload.stream!==true||!Array.isArray(payload.messages))throw Error('crud-fixture-invalid-payload');
    const lastUser=payload.messages.findLastIndex(message=>message.role==='user');
    if(lastUser<0)throw Error('crud-fixture-missing-user');
    const text=JSON.stringify(payload.messages[lastUser].content);
    const recovery=/Continue from the saved checkpoint/.test(text);
    const calls=recovery?crudRecoveryCalls:[{name:'project_bash',args:{script:'mkdir -p model',timeoutMs:5000}},...crudMutationCalls];
    const results=payload.messages.slice(lastUser+1).filter(message=>message.role==='tool');
    if(results.length!==0&&results.length!==calls.length)throw Error('crud-fixture-incomplete-tools');
    if(results.length&&recovery)for(let i=0;i<results.length;i++){
      if(!JSON.stringify(results[i].content).includes(crudExpectedFiles[calls[i].args.path].trim()))throw Error('crud-fixture-recovery-content-mismatch');
    }
    const chunks=[];
    const chunk=(delta,finish_reason=null)=>chunks.push(`data: ${JSON.stringify({id:`chatcmpl-crud-${recovery?'restore':'mutate'}`,object:'chat.completion.chunk',created:1,model:modelId,choices:[{index:0,delta,finish_reason}]})}\n\n`);
    chunk({role:'assistant'});
    if(!results.length){
      chunk({tool_calls:calls.map((call,index)=>({index,id:`crud-${recovery?'read':'mutation'}-${index+1}`,type:'function',function:{name:call.name,arguments:JSON.stringify(call.args)}}))});
      chunk({},'tool_calls');
    }else{chunk({content:recovery?'Fixture verified restored file contents.':'Fixture completed 20 file mutations.'});chunk({},'stop');}
    return new Response(chunks.join('')+'data: [DONE]\n\n',{headers:{'content-type':'text/event-stream','x-request-id':'local-crud-fixture'}});
  };
}
