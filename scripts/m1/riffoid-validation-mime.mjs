// Parse module payloads as bytes, including parts without a filename. Never
// decode/re-encode source or normalize its line endings.
import assert from 'node:assert/strict';
const moduleName=/^[A-Za-z0-9_.-]{1,200}$/;
export function validateEntrypoint(value){
  assert.ok(typeof value==='string'&&moduleName.test(value),'one valid cf-entrypoint required; missing/combined/duplicate values forbidden');
  return value;
}
export function multipartModules(raw,expected){
  assert.equal(raw.status,200);const main=validateEntrypoint(raw.mainModule);
  assert.ok(Array.isArray(expected)&&expected.length>0&&expected.length<=100);
  const names=expected.map(m=>m.name);assert.ok(names.every(n=>typeof n==='string'&&moduleName.test(n)));assert.ok(expected.every(m=>Number.isSafeInteger(m.bytes)&&m.bytes>=0&&m.bytes<=16*1024*1024));assert.equal(new Set(names).size,names.length,'duplicate expected module');assert.ok(names.includes(main),'entrypoint must name a frozen module');
  assert.ok(Buffer.isBuffer(raw.bytes)||raw.bytes instanceof Uint8Array);const bytes=Buffer.from(raw.bytes);
  assert.ok(bytes.length>0&&bytes.length<=16*1024*1024,'bounded MIME body required');
  const type=/^multipart\/form-data\s*;\s*boundary=(?:"([^"\r\n]+)"|([^;\s]+))\s*$/i.exec(raw.contentType??'');
  assert.ok(type,'one multipart boundary required');const boundary=type[1]??type[2];
  assert.ok(/^[A-Za-z0-9'()+_,.\/:=? -]{1,70}$/.test(boundary)&&!boundary.endsWith(' '),'invalid MIME boundary');
  const delimiter=Buffer.from('--'+boundary),next=Buffer.from('\r\n--'+boundary),headerEnd=Buffer.from('\r\n\r\n');
  const at=(position,value)=>bytes.subarray(position,position+value.length).equals(value);
  const crlf=Buffer.from('\r\n'),close=Buffer.from('--');const parts=new Map();let position=0;
  function nextBoundary(start){
    for(let p=bytes.indexOf(next,start);p!==-1;p=bytes.indexOf(next,p+1)){
      const after=p+next.length;
      if(at(after,crlf)||at(after,close)&&(after+2===bytes.length||at(after+2,crlf)))return p;
    }
    assert.fail('missing complete MIME closing boundary; truncated body');
  }
  while(true){
    assert.ok(at(position,delimiter),'MIME boundary position/CRLF invalid');position+=delimiter.length;
    if(at(position,close)){
      position+=2;if(at(position,crlf))position+=2;
      assert.equal(position,bytes.length,'unexpected MIME epilogue/trailing bytes');break;
    }
    assert.ok(at(position,crlf),'MIME delimiter requires CRLF');position+=2;
    const end=bytes.indexOf(headerEnd,position);assert.ok(end!==-1&&end-position<=8192,'bounded complete part headers required');
    const headerBytes=bytes.subarray(position,end);assert.ok([...headerBytes].every(b=>b===9||b===10||b===13||b>=32&&b<=126),'ASCII MIME headers required');
    const headers=new Map();
    for(const line of headerBytes.toString('ascii').split('\r\n')){
      const m=/^([A-Za-z0-9-]+):[ \t]*(.*)$/.exec(line);assert.ok(m&&!/[\r\n]/.test(m[2]),'malformed/folded part header');
      const key=m[1].toLowerCase();assert.ok(!headers.has(key),'duplicate part header');headers.set(key,m[2]);
    }
    const disposition=headers.get('content-disposition');assert.ok(disposition,'part disposition required');
    const fields=disposition.split(';').map(x=>x.trim());assert.equal(fields.shift()?.toLowerCase(),'form-data');const params=new Map();
    for(const field of fields){const m=/^(name|filename)="([^"\\;\r\n]*)"$/.exec(field);assert.ok(m,'unsupported/ambiguous disposition parameter');assert.ok(!params.has(m[1]),'duplicate disposition parameter');params.set(m[1],m[2]);}
    const name=params.get('name');assert.ok(typeof name==='string'&&moduleName.test(name),'one module part name required');
    if(params.has('filename'))assert.equal(params.get('filename'),name,'conflicting module filename');
    assert.ok(!headers.has('content-transfer-encoding'),'encoded MIME source forbidden');
    assert.ok(names.includes(name),'unexpected module part');assert.ok(!parts.has(name),'duplicate module part');
    const payloadStart=end+4,payloadEnd=nextBoundary(payloadStart),payload=bytes.subarray(payloadStart,payloadEnd);
    if(headers.has('content-length')){const length=headers.get('content-length');assert.match(length,/^(?:0|[1-9][0-9]*)$/);assert.equal(Number(length),payload.length,'part Content-Length mismatch/truncation');}
    const frozen=expected.find(m=>m.name===name);assert.equal(payload.length,frozen.bytes,'frozen module length mismatch/truncation');
    parts.set(name,Buffer.from(payload));assert.ok(parts.size<=100);position=payloadEnd+2;
  }
  assert.equal(parts.size,names.length,'missing frozen module');
  return expected.map(m=>({name:m.name,bytes:parts.get(m.name)}));
}
