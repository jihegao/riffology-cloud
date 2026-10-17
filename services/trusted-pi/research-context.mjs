const URL = 'https://tool-bridge.riffology.internal/v1/research';
const MAX = 64 * 1024;
function valid(value) { return value && typeof value === 'object' && !Array.isArray(value) && Array.isArray(value.experiments) && (value.model === null || typeof value.model === 'object'); }
export async function fetchResearchContext(fetchImpl, identity, executionDeadlineAt) {
  const response = await fetchImpl(URL, { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json' }, body: JSON.stringify({ identity, executionDeadlineAt }), signal: AbortSignal.timeout(10000) });
  const reader=response.body?.getReader();if(!reader)throw Error('invalid-research-context-response');const parts=[];let size=0;try{for(;;){const item=await reader.read();if(item.done)break;size+=item.value.byteLength;if(size>MAX)throw Error('research-context-response-too-large');parts.push(item.value);}}finally{await reader.cancel().catch(()=>{});}
  const bytes=new Uint8Array(size);let offset=0;for(const part of parts){bytes.set(part,offset);offset+=part.byteLength;}
  if (bytes.byteLength < 1 || bytes.byteLength > MAX) throw Error('research-context-response-too-large');
  let value; try { value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); } catch { throw Error('invalid-research-context-response'); }
  if (!response.ok) throw Error(/^project-resource-[a-z-]+$/.test(value?.error) ? value.error : 'research-context-request-failed');
  if (!valid(value)) throw Error('invalid-research-context-response');
  return value;
}
