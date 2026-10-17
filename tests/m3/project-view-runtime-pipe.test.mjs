import assert from 'node:assert/strict';
import test from 'node:test';
import {createProjectViewRuntimePipe,PROJECT_VIEW_BROWSER_PROGRAM} from '../../services/project-views/runtime-pipe.mjs';

const encoder=new TextEncoder();
const tick=()=>new Promise(resolve=>setImmediate(resolve));
function fixture(){
 let output,finish,kills=0;const writes=[];
 const stdout=new ReadableStream({start(controller){output=controller;}}),exitCode=new Promise(resolve=>{finish=resolve;});
 const stdin=new WritableStream({write(chunk){writes.push(JSON.parse(new TextDecoder().decode(chunk)));},close(){output.close();finish(0);}});
 const pipe=createProjectViewRuntimePipe({stdin,stdout,exitCode,kill(){kills++;}},{pkg:{canary:'fixed'},view:{id:'home'}});
 return {pipe,writes,get kills(){return kills;},emit(value){output.enqueue(encoder.encode(JSON.stringify(value)+'\n'));},bytes(value){output.enqueue(value);}};
}
function image(){const value=new Uint8Array(33);value.set([137,80,78,71,13,10,26,10]);const view=new DataView(value.buffer);view.setUint32(16,800);view.setUint32(20,600);return btoa(String.fromCharCode(...value));}

test('fixed stdin bootstrap, bounded output, single pending capture and latest-frame polling',async()=>{
 const f=fixture();await f.pipe.ready;assert.equal(f.writes[0].type,'init');assert.deepEqual(f.writes[0].package,{canary:'fixed'});assert.ok(f.writes[0].frameHtml.length>100);assert.match(PROJECT_VIEW_BROWSER_PROGRAM,/chromiumSandbox:true/);
 await f.pipe.capture();await f.pipe.capture();assert.equal(f.writes.filter(value=>value.type==='capture').length,1);
 f.emit({type:'broker',message:{type:'installed'}});f.emit({type:'frame',base64:image(),width:800,height:600});await tick();
 assert.deepEqual(f.pipe.poll(),{messages:[{type:'installed'}],frame:{base64:image(),width:800,height:600}});assert.deepEqual(f.pipe.poll(),{messages:[]});
 await f.pipe.capture();assert.equal(f.writes.filter(value=>value.type==='capture').length,2);
 await f.pipe.close();await f.pipe.finished;assert.equal(f.writes.at(-1).type,'close');assert.equal(f.kills,0);
});

test('one-byte stdout fragments reassemble without an unbounded chunk-object collection',async()=>{
 const f=fixture();await f.pipe.ready;const line=encoder.encode(JSON.stringify({type:'broker',message:{id:1,type:'files.read',path:'docs/data.json'}})+'\n');
 for(const byte of line)f.bytes(Uint8Array.of(byte));await tick();
 assert.deepEqual(f.pipe.poll(),{messages:[{id:1,type:'files.read',path:'docs/data.json'}]});await f.pipe.close();await f.pipe.finished;
});

for(const [name,value] of [
 ['oversized broker output',{type:'broker',message:{private:'x'.repeat(4097)}}],
 ['private network URL diagnostic',{type:'network',event:'requestfailed',error:'https://private.example/user-text'}],
 ['forged image dimensions',{type:'frame',base64:image(),width:1,height:600}],
 ['unknown output envelope',{type:'exec',command:'touch /tmp/forged'}],
])test(name+' fences the pipe',async()=>{
 const f=fixture();await f.pipe.ready;f.emit(value);await assert.rejects(f.pipe.finished,/pipe-invalid/);assert.equal(f.kills,1);assert.throws(()=>f.pipe.poll(),/pipe-invalid/);
});

test('line byte ceiling rejects a single unterminated output flood',async()=>{
 const f=fixture();await f.pipe.ready;f.bytes(new Uint8Array(3*1024*1024+1));await assert.rejects(f.pipe.finished,/pipe-invalid/);assert.equal(f.kills,1);
});
