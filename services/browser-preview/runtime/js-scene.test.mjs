import assert from 'node:assert/strict';
import test from 'node:test';
import {JS_LIMITS,sceneSelection,validateFrontendEvent,validateFrontendManifest,validateFrontendScene} from './js-scene.mjs';

const manifest={schema:'riffology.browser-js/v1',hostApi:'riffology.browser-host/v1',entry:'frontend/main.mjs',width:600,height:420};
const scene={schema:'riffology.browser-scene/v1',background:'#fff',marks:[
 {kind:'rect',id:'server-a',x:20,y:30,width:80,height:40,fill:'#2563eb'},
 {kind:'circle',id:'job-1',x:200,y:100,radius:12,fill:'#f97316'},
 {kind:'line',x1:100,y1:50,x2:188,y2:96,stroke:'#334155',width:2},
 {kind:'text',x:20,y:100,text:'completed: 4',fill:'#0f172a',size:16},
]};

test('restricted frontend scene accepts the fixed manifest and finite 2D marks',()=>{
 assert.deepEqual(validateFrontendManifest(manifest),manifest);
 assert.deepEqual(validateFrontendScene(scene),scene);
 assert.equal(sceneSelection(scene,50,45),'server-a');
 assert.equal(sceneSelection(scene,200,100),'job-1');
 assert.equal(sceneSelection(scene,590,410),null);
});

test('scene output rejects spoof fields, unsafe geometry, duplicate ids and output limits',()=>{
 assert.throws(()=>validateFrontendManifest({...manifest,network:true}),/manifest-invalid/);
 assert.throws(()=>validateFrontendScene({...scene,evidence:{verified:true}}),/scene-invalid/);
 assert.throws(()=>validateFrontendScene({...scene,marks:[{kind:'rect',x:590,y:0,width:20,height:10,fill:'#fff'}]}),/mark-invalid/);
 assert.throws(()=>validateFrontendScene({...scene,marks:[scene.marks[0],{...scene.marks[0]}]}),/mark-invalid/);
 assert.throws(()=>validateFrontendScene({schema:'riffology.browser-scene/v1',marks:Array(JS_LIMITS.marks+1).fill(scene.marks[0])}),/scene-invalid/);
});

test('frontend events are exact, finite and canvas bounded',()=>{
 for(const event of [{type:'pointer',x:0,y:420,button:0},{type:'select',id:'server-a'},null])assert.deepEqual(validateFrontendEvent(event),event);
 for(const event of [{type:'pointer',x:601,y:0,button:0},{type:'pointer',x:0,y:0,button:5},{type:'select',id:''},{type:'action',name:'verify'},{type:'pointer',x:0,y:0,button:0,trace:{}}])assert.throws(()=>validateFrontendEvent(event),/event-invalid/);
});
