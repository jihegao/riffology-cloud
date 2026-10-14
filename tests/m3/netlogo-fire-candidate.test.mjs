import assert from 'node:assert/strict';
import test from 'node:test';
import {execFileSync,spawnSync} from 'node:child_process';
import {mkdtemp,readFile,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {initialWorkspaceArchive} from '../../services/workspace/initial-archive.ts';
import {workspaceArchiveReader} from '../../services/turn-runtime/workspace-file-index.ts';
import {validateSavedPreview} from '../../services/browser-preview/validator.ts';
import {productionPreviewRegistry} from '../../services/browser-preview/production-registry.ts';
import {validateTrace,LIMITS} from '../../services/browser-preview/runtime/protocol.mjs';
import {parseModelSpec,resolveParameters} from '../../services/simulation/model-spec.ts';

const root=resolve('examples/netlogo-fire-candidate');
const paths=['model/model.py','model/run.py','model/model-spec.json','model/visualization.json','app/requirements.lock'];
const decode=bytes=>new TextDecoder().decode(bytes);
async function candidate(){
 const files=Object.fromEntries(await Promise.all(paths.map(async path=>[path,new Uint8Array(await readFile(join(root,path)))])));
 const archive=initialWorkspaceArchive(files),reader=workspaceArchiveReader(archive);
 const source={projectId:'netlogo-fire-candidate',revisionId:'local-candidate',filesSha256:await reader.sha256()};
 return {files,archive,source};
}
function python(code){
 return JSON.parse(execFileSync('python3',['-c',code],{encoding:'utf8',maxBuffer:16*1024*1024,env:{...process.env,PYTHONDONTWRITEBYTECODE:'1',PYTHONPATH:join(root,'model')}}));
}

test('candidate uses the exact canonical adapter and passes the saved Preview contract',async()=>{
 const c=await candidate();
 assert.deepEqual(c.files['model/run.py'],new Uint8Array(await readFile('services/run/model_run_adapter.py')));
 const checked=await validateSavedPreview(c.source,c.archive,'python-stdlib/v1',await productionPreviewRegistry());
 assert.equal(checked.status,'compatible');
 if(checked.status!=='compatible')return;
 assert.equal(checked.value.visualization.renderer,'python-canvas');
 assert.equal(checked.value.profile.runtime.profileId,'python-stdlib/v1');
 assert.deepEqual(checked.value.profile.packages,{});
 const spec=parseModelSpec(JSON.parse(decode(c.files['model/model-spec.json'])));
 assert.deepEqual(resolveParameters(spec,{}),{density_percent:57,steps:5});
 assert.equal(spec.parameters.density_percent.unit,'percent');
});

test('hand-derived setup and spread preserve left ignition, neighbors4, finite boundaries and frozen fronts',()=>{
 const observed=python(`
import json
from model import _setup, _advance
green, fires, embers, burned, initial, count = _setup(100, 7, 3, 2)
setup = {'green': sorted(green), 'fires': sorted(fires), 'initial': initial, 'burned_trees': count}
green={(1,0),(0,1),(1,1),(2,0)}
fires={(0,0)}
burned={(0,0)}
first, embers, count = _advance(green,fires,{},burned,0,3,3)
after_first={'fires':sorted(first),'green':sorted(green),'burned_trees':count,'embers':sorted(embers)}
second, embers, count = _advance(green,first,embers,burned,count,3,3)
after_second={'fires':sorted(second),'green':sorted(green),'burned_trees':count}
print(json.dumps({'setup':setup,'first':after_first,'second':after_second}))
`);
 assert.deepEqual(observed.setup,{green:[[1,0],[1,1],[2,0],[2,1]],fires:[[0,0],[0,1]],initial:4,burned_trees:0});
 assert.deepEqual(observed.first.fires,[[0,1],[1,0]]);
 assert.deepEqual(observed.first.green,[[1,1],[2,0]]);
 assert.equal(observed.first.burned_trees,2);
 assert.deepEqual(observed.first.embers,[[0,0]]);
 assert.deepEqual(observed.second.fires,[[1,1],[2,0]]);
 assert.deepEqual(observed.second.green,[]);
 assert.equal(observed.second.burned_trees,4);
});

test('seeded runs reproduce locally without claiming NetLogo seed equivalence',()=>{
 const observed=python(`
import json
from model import run
config={'parameters':{'density_percent':57,'steps':8},'seed':20261001}
a=run(config);b=run(config)
c=run({'parameters':{'density_percent':57,'steps':8},'seed':20261002})
print(json.dumps({'same':a==b,'different':a!=c,'a0':a['snapshots'][0]['metrics'],'c0':c['snapshots'][0]['metrics']}))
`);
 assert.equal(observed.same,true);
 assert.equal(observed.different,true);
 assert.equal(observed.a0.active_fires,31);
 assert.equal(observed.a0.burned_trees,0);
 assert.notEqual(observed.a0.initial_trees,observed.c0.initial_trees);
});

test('embers preserve NetLogo stop timing after a zero-density setup',()=>{
 const observed=python(`
import json
from model import run
trace=run({'parameters':{'density_percent':0,'steps':20},'seed':1})
states=[{a['state'] for a in snapshot['agents']} for snapshot in trace['snapshots']]
print(json.dumps({'frames':[s['frame'] for s in trace['snapshots']],
                  'frame11':sorted(states[11]),'frame12':sorted(states[12]),
                  'fires':[s['metrics']['active_fires'] for s in trace['snapshots']]}))
`);
 assert.deepEqual(observed.frames,[0,1,2,3,4,5,6,7,8,9,10,11,12]);
 assert.deepEqual(observed.frame11,['ember']);
 assert.deepEqual(observed.frame12,['burned']);
 assert.deepEqual(observed.fires,[31,0,0,0,0,0,0,0,0,0,0,0,0]);
});

test('all declared parameter extremes produce valid bounded traces',()=>{
 const rows=python(`
import json
from model import run
values=[]
for density in (0,57,99):
 trace=run({'parameters':{'density_percent':density,'steps':80},'seed':4294967295})
 raw=json.dumps(trace,separators=(',',':'),allow_nan=False).encode()
 values.append({'density':density,'bytes':len(raw),'trace':trace})
print(json.dumps(values,separators=(',',':')))
`);
 for(const row of rows){
  assert.ok(row.bytes<=LIMITS.resultBytes);
  assert.ok(row.trace.snapshots.length<=81);
  assert.ok(row.trace.snapshots.every(snapshot=>snapshot.agents.length<=961));
  validateTrace(row.trace);
  const final=row.trace.snapshots.at(-1).metrics;
  assert.ok(final.burned_trees<=final.initial_trees);
  assert.equal(final.trees_remaining+final.burned_trees,final.initial_trees);
 }
});

test('invalid direct model inputs fail closed without coercion or clamping',()=>{
 const script=`
from model import run
cases=[
 {'parameters':{'density_percent':57.0,'steps':2},'seed':1},
 {'parameters':{'density_percent':100,'steps':2},'seed':1},
 {'parameters':{'density_percent':57,'steps':0},'seed':1},
 {'parameters':{'density_percent':57,'steps':81},'seed':1},
 {'parameters':{'density_percent':57,'steps':2,'extra':1},'seed':1},
 {'parameters':{'density_percent':57,'steps':2},'seed':-1},
]
for value in cases:
 try: run(value)
 except ValueError: continue
 raise AssertionError('accepted invalid input')
`;
 execFileSync('python3',['-c',script],{env:{...process.env,PYTHONDONTWRITEBYTECODE:'1',PYTHONPATH:join(root,'model')}});
});

test('CPython executes through the shared adapter and persists Fire summary metrics',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'riffology-fire-candidate-'));
 try{
  await Promise.all(['model.py','run.py','model-spec.json'].map(name=>readFile(join(root,'model',name)).then(bytes=>writeFile(join(directory,name),bytes))));
  await writeFile(join(directory,'input.json'),JSON.stringify({schemaVersion:1,runId:'local-fire',parameters:{density_percent:57,steps:8},seed:20261001}));
  const reply=spawnSync('python3',[join(directory,'run.py'),'--input',join(directory,'input.json'),'--output',join(directory,'result.json')],{encoding:'utf8',timeout:10000});
  assert.equal(reply.status,0,reply.stderr);
  const result=JSON.parse(await readFile(join(directory,'result.json'),'utf8'));
  const summary=JSON.parse(await readFile(join(directory,'summary.json'),'utf8'));
  assert.deepEqual(result.metrics,summary.metrics);
  assert.equal(summary.model,'netlogo-fire-7.0.4-python-adaptation');
  assert.equal(summary.metrics.active_fires,summary.metrics.active_fires|0);
  const audit=JSON.parse(await readFile(join(directory,'trace-audit.json'),'utf8'));
  assert.deepEqual(audit.columns,['frame','time','queue_length','completed','abandoned','rejected','active','waiting']);
  assert.ok(audit.rows.length>=2);
 }finally{await rm(directory,{recursive:true,force:true});}
});
