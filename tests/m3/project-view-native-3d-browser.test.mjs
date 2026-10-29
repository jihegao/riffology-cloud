import test from 'node:test';
import assert from 'node:assert/strict';
import {packaged,projectFiles,scope} from './project-views-fixture.mjs';
import {localBrowserFixture,projectFrame} from './project-view-local-fixture.mjs';

// This fixture validates the real saved-page bootstrap and WebGL drawing, not
// the quality of an Agent-generated model or a production acceptance.
test('saved native page draws and updates real 3D geometry inside the local opaque frame',async t=>{
 const files=projectFiles();
 files['app/home.html']='<!doctype html><h1>Local 3D geometry</h1><label>Rotation <input id="rotation" type="range" min="0" max="90" value="0"></label><canvas id="scene" width="180" height="180"></canvas><output id="state">starting</output><script type="module" src="./main.mjs"></script>';
 files['app/main.mjs']=`
const canvas=document.querySelector('#scene'),gl=canvas.getContext('webgl',{preserveDrawingBuffer:true});
if(!gl)throw Error('WebGL unavailable');
function shader(type,source){const s=gl.createShader(type);gl.shaderSource(s,source);gl.compileShader(s);if(!gl.getShaderParameter(s,gl.COMPILE_STATUS))throw Error(gl.getShaderInfoLog(s));return s;}
const vertex=shader(gl.VERTEX_SHADER,'attribute vec3 p; uniform float angle; varying vec3 color; void main(){float c=cos(angle),s=sin(angle);vec3 q=vec3(c*p.x+s*p.z,p.y,-s*p.x+c*p.z);float w=2.8-q.z;gl_Position=vec4(q.x,q.y,q.z*0.2,w);color=p*0.5+0.5;}');
const fragment=shader(gl.FRAGMENT_SHADER,'precision mediump float; varying vec3 color; void main(){gl_FragColor=vec4(color,1.0);}');
const program=gl.createProgram();gl.attachShader(program,vertex);gl.attachShader(program,fragment);gl.linkProgram(program);if(!gl.getProgramParameter(program,gl.LINK_STATUS))throw Error(gl.getProgramInfoLog(program));gl.useProgram(program);
const points=new Float32Array([-1,-1,-1, 1,-1,-1, 1,1,-1, -1,1,-1, -1,-1,1, 1,-1,1, 1,1,1, -1,1,1]);
const faces=new Uint16Array([0,1,2,0,2,3, 4,6,5,4,7,6, 0,4,5,0,5,1, 3,2,6,3,6,7, 1,5,6,1,6,2, 0,3,7,0,7,4]);
const v=gl.createBuffer();gl.bindBuffer(gl.ARRAY_BUFFER,v);gl.bufferData(gl.ARRAY_BUFFER,points,gl.STATIC_DRAW);const attr=gl.getAttribLocation(program,'p');gl.enableVertexAttribArray(attr);gl.vertexAttribPointer(attr,3,gl.FLOAT,false,0,0);
const ix=gl.createBuffer();gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER,ix);gl.bufferData(gl.ELEMENT_ARRAY_BUFFER,faces,gl.STATIC_DRAW);gl.enable(gl.DEPTH_TEST);const input=document.querySelector('#rotation');
function draw(){gl.viewport(0,0,canvas.width,canvas.height);gl.clearColor(0,0,0,1);gl.clear(gl.COLOR_BUFFER_BIT|gl.DEPTH_BUFFER_BIT);gl.uniform1f(gl.getUniformLocation(program,'angle'),Number(input.value)*Math.PI/180);gl.drawElements(gl.TRIANGLES,faces.length,gl.UNSIGNED_SHORT,0);if(gl.getError()!==gl.NO_ERROR)throw Error('draw failed');document.querySelector('#state').textContent='drawn';}
input.addEventListener('input',draw);draw();
`;
 const {pkg}=await packaged(files);let f;
 f=await localBrowserFixture(t,{handler:async(_req,res,url)=>{
  if(!url.pathname.endsWith('/project-views')&&!url.pathname.includes('/project-view-artifacts'))return false;
  res.setHeader('content-type','application/json');res.end(JSON.stringify(url.pathname.includes('/project-view-artifacts')?{items:[],nextCursor:null,version:'a'.repeat(64)}:url.searchParams.has('identity')?{current:true}:{package:pkg,delivery:f.delivery}));return true;
 }});
 await f.page.evaluate(async scope=>{(await import('/i18n.js')).setLocale('en',{persist:false});const {createProjectViewsPanel}=await import('/project-views.js');window.api=async(path,options)=>{const r=await fetch(path,options);if(!r.ok)throw Error('denied');return r.json();};window.panel=createProjectViewsPanel({root:document.querySelector('#root'),api});await panel.enter(scope);},scope);
 await f.page.getByText('Saved page · browser local / unverified',{exact:true}).waitFor();
 const child=projectFrame(f);await child.locator('#state').filter({hasText:'drawn'}).waitFor();
 const pixels=()=>child.evaluate(()=>{const c=document.querySelector('#scene'),gl=c.getContext('webgl'),data=new Uint8Array(c.width*c.height*4);gl.readPixels(0,0,c.width,c.height,gl.RGBA,gl.UNSIGNED_BYTE,data);let colored=0,checksum=0;for(let i=0;i<data.length;i+=4){if(data[i]||data[i+1]||data[i+2])colored++;checksum=(checksum+data[i]*(i+1)+data[i+1]*(i+2)+data[i+2]*(i+3))%2147483647;}return {colored,checksum};});
 const initial=await pixels();assert.ok(initial.colored>1000,'GPU must produce visible colored pixels');
 await child.locator('#rotation').fill('45');const rotated=await pixels();assert.ok(rotated.colored>1000);assert.notEqual(rotated.checksum,initial.checksum,'interaction must change the rendered 3D scene');
 await f.page.evaluate(()=>panel.leave());assert.equal(await f.page.locator('iframe').count(),0);assert.deepEqual(f.errors,[]);
 assert.equal(f.requests.some(r=>r.method!=='GET'||r.path.includes('project-view-sessions')||r.path.includes('/runs')||r.path.includes('/turns')),false);
});
