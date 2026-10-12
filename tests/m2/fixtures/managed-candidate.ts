import type {ModelSpec} from '../../../services/simulation/model-spec.ts';
import type {RuntimeTrace} from '../../../services/browser-preview/runtime/protocol.mjs';

/** Reported candidate fixtures, never proof that attached model code ran. */
export function managedCandidateFixture(domain:'road'|'queue'|'grid'|'airport'='queue',renderer?:'grid'|'lane'|'python-canvas'|'javascript-canvas'){
 const metric=domain==='grid'?'population':'completed';
 const spec:ModelSpec={schemaVersion:1,researchQuestion:'How do the configured agents evolve?',scope:domain,entities:[domain==='airport'?'aircraft':'agents'],mechanisms:['finite steps'],assumptions:[],limitations:['Reported candidate fixture'],parameters:{steps:{type:'integer',default:2,minimum:1,maximum:500},enabled:{type:'boolean',default:true},mode:{type:'enum',default:'normal',values:['normal','slow']}},metrics:{[metric]:{unit:'count'}},execution:{entrypoint:'model/run.py',dependencyLock:'app/requirements.lock'}};
 const lanes=domain==='road'?['road']:domain==='airport'?['runway','taxiway','near-stand','remote-stand']:['waiting','service'];
 const space=domain==='grid'?{type:'grid' as const,width:2,height:2}:{type:'lane' as const,lanes};
 const trace:RuntimeTrace={model:domain,snapshots:[0,1,2].map(frame=>({schemaVersion:'riffology.visual/v0.1' as const,frame,time:frame,space,agents:domain==='grid'?[{id:'tree-1',type:'tree',state:frame===0?'healthy':'burning',x:1,y:0}]:[{id:domain==='airport'?'flight-1':'customer-1',type:domain==='airport'?'aircraft':'customer',state:frame===0?'waiting':'moving',lane:lanes[Math.min(frame,lanes.length-1)],position:frame}],metrics:{[metric]:frame}}))};
 const input={parameters:{steps:2,enabled:true,mode:'normal'},seed:42};
 const selected=renderer??(domain==='grid'?'grid':'lane');
 const files:Record<string,string>={
  'model/model.py':'import json\ndef run(config):\n    return json.loads('+JSON.stringify(JSON.stringify(trace))+')\n'+(selected==='python-canvas'?'def draw(snapshot, canvas, event=None):\n    canvas.clear("#ffffff")\n':''),
  'model/results.json':JSON.stringify({seed:42,parameters:input.parameters,metrics:{[metric]:2},frameCount:3}),
  'app/requirements.lock':'{"schemaVersion":1,"packages":{}}',
  'model/visualization.json':JSON.stringify({schema:'riffology.visualization/v1',protocol:'riffology.visual/v0.1',renderer:selected,metricKeys:[metric]}),
 };
 if(selected==='javascript-canvas'){
  files['frontend/manifest.json']=JSON.stringify({schema:'riffology.browser-js/v1',hostApi:'riffology.browser-host/v1',entry:'frontend/main.mjs',width:600,height:420});
  files['frontend/main.mjs']='export function render(context) { return {schema:"riffology.browser-scene/v1",background:"#fff",marks:[{kind:"text",x:10,y:20,text:String(context.snapshot.frame),fill:"#123456",size:14}]}; }\n';
 }
 return {schemaVersion:2 as const,spec,files,preview:{profileId:'python-stdlib/v1' as string,input,trace}};
}
