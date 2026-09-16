import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {spawn} from 'node:child_process';
import {benchmarkTaskFixtures,validateBenchmarkTaskFixtures,sha256} from './benchmark-task-fixtures.mjs';
import {canonicalPreviewJson} from '../../services/browser-preview/contract.ts';
const directory=new URL('./benchmark-task-fixtures/',import.meta.url);
async function frozen(){return JSON.parse(await readFile(new URL('fixtures.json',directory),'utf8'));}
test('frozen eighteen-task inventory is complete, deterministic and contains no authorization',async()=>{const input=await frozen(),bytes=await readFile(new URL('fixtures.json',directory));assert.deepEqual(await benchmarkTaskFixtures(),input);assert.equal(bytes.toString(),canonicalPreviewJson(input)+'\n');assert.equal((await readFile(new URL('fixtures.sha256',directory),'utf8')).split(' ')[0],sha256(bytes));assert.deepEqual(validateBenchmarkTaskFixtures(input),{kind:input.kind,attempts:18,projects:3,upstreamCalls:0,durableProjectsCreated:0});const corrupt=structuredClone(input);corrupt.assets.abandonment.files[0].base64=corrupt.assets.base.files[0].base64;assert.throws(()=>validateBenchmarkTaskFixtures(corrupt),/integrity/);const fakeAuthorization=structuredClone(input);fakeAuthorization.execution.authorizationReference='pretend-approved';assert.throws(()=>validateBenchmarkTaskFixtures(fakeAuthorization),/boundary/);});
test('proposal B freezes a six-call same-Turn surgical repair below the Turn message limit',async()=>{const input=await frozen(),repairs=input.sequence.filter(task=>task.id==='repair-validation');assert.deepEqual(input.repairWorkflow,{kind:'same-ordinary-user-turn-tool-sandbox-v1',toolCalls:6,maxToolCalls:8,failureSha256:input.assets.seededFailure.sha256,repairSha256:input.assets.abandonment.files[0].sha256,repairMutation:{kind:'single-exact-utf8-line-replacement-v1',from:'def run(config)\n',to:'def run(config):\n',occurrences:1},failedRevisionExpected:false,failedArtifactExpected:false});assert.equal(repairs.length,3);for(const task of repairs){assert.ok(Buffer.byteLength(task.prompt)<16000);assert.ok(task.prompt.includes(input.assets.seededFailure.base64));assert.ok(!task.prompt.includes(input.assets.abandonment.files[0].base64));assert.ok(task.prompt.includes('one tool call at a time'));assert.ok(task.prompt.includes('await its terminal result'));assert.ok(task.prompt.includes('stop immediately without retrying, replacing, or adding a tool call'));assert.ok(task.prompt.includes('private Tool Ledger receipts are collected separately by the authority and must not be guessed or cited'));assert.ok(!task.prompt.includes('their private Tool Ledger receipt digests'));assert.ok(task.prompt.includes('replace only that line ending'));assert.ok(task.prompt.includes('structured failed validation result'));}const leaked=structuredClone(input);leaked.sequence.find(task=>task.id==='repair-validation').prompt+=input.assets.abandonment.files[0].base64;assert.throws(()=>validateBenchmarkTaskFixtures(leaked),/failure-workflow/);const ambiguous=structuredClone(input);ambiguous.repairWorkflow.repairMutation.occurrences=2;assert.throws(()=>validateBenchmarkTaskFixtures(ambiguous),/boundary/);});
function python(input){return new Promise((resolve,reject)=>{const child=spawn(process.env.BENCHMARK_FIXTURE_PYTHON||'python3',['-I','-c',String.raw`
import json, math, sys, hashlib
fixtures=json.load(sys.stdin)
models={}
for name in ['base','abandonment','capacity']:
    import base64
    source=base64.b64decode(fixtures['assets'][name]['files'][0]['base64'])
    namespace={}
    exec(compile(source,'model/model.py','exec'),namespace)
    models[name]=namespace['run']
failure=base64.b64decode(fixtures['assets']['seededFailure']['base64'])
try:
    compile(failure,'model/model.py','exec')
    raise AssertionError('seeded failure unexpectedly compiled')
except SyntaxError as error:
    assert error.lineno==5
    failed={'exception':type(error).__name__,'line':error.lineno,'sha256':hashlib.sha256(failure).hexdigest()}
rows=[]
def run(name,parameters,seed):
    request=dict(parameters=parameters,seed=seed)
    trace=models[name](request)
    assert trace==models[name](request), 'same-input determinism failed'
    snapshots=trace['snapshots']
    assert 1<=len(snapshots)<=501
    assert len(snapshots[-1]['agents'])==0
    assert [s['time'] for s in snapshots]==sorted(s['time'] for s in snapshots)
    first_seen={}
    first_service={}
    for frame,snapshot in enumerate(snapshots):
        assert snapshot['frame']==frame
        assert snapshot['metrics']['queue_length']==sum(a['state']=='waiting' for a in snapshot['agents'])
        assert len({a['id'] for a in snapshot['agents']})==len(snapshot['agents'])
        assert all(isinstance(v,(int,float)) and math.isfinite(v) and v>=0 for v in snapshot['metrics'].values())
        if name=='capacity': assert snapshot['metrics']['queue_length']<=parameters['queue_capacity']
        for agent in snapshot['agents']:
            first_seen.setdefault(agent['id'],snapshot['time'])
            if agent['state']=='serving': first_service.setdefault(agent['id'],snapshot['time'])
    for key in ['completed','abandoned','rejected']:
        values=[s['metrics'].get(key,0) for s in snapshots]
        assert values==sorted(values)
    final=snapshots[-1]['metrics']
    assert sum(final.get(k,0) for k in ['completed','abandoned','rejected'])==parameters['customers']
    if name!='base':
        assert all(start-first_seen[customer]<=parameters['max_wait']+1e-9 for customer,start in first_service.items())
    digest=hashlib.sha256(json.dumps(trace,sort_keys=True,separators=(',',':')).encode()).hexdigest()
    return dict(final=final,frames=len(snapshots),traceSha256=digest)
for repetition in fixtures['repetitions']:
    task=next(t for t in fixtures['sequence'] if t['repeat']==repetition['repeat'] and t['id']=='parameter-change')
    for seed in repetition['comparisonSeeds']:
        baseline=run('base',task['inputs']['baseline'],seed)
        intervention=run('base',task['inputs']['intervention'],seed)
        assert intervention['final']['mean_wait']>=baseline['final']['mean_wait']-1e-9
        mechanism=next(t for t in fixtures['sequence'] if t['repeat']==repetition['repeat'] and t['id']=='measured-evidence')
        repaired=run('abandonment',mechanism['inputs']['baseline'],seed)
        assert repaired['final']['abandoned']>0
        capacity=next(t for t in fixtures['sequence'] if t['repeat']==repetition['repeat'] and t['id']=='reopen-continue')
        extension=run('capacity',capacity['inputs']['intervention'],seed)
        zero_wait=run('abandonment',{**mechanism['inputs']['baseline'],'max_wait':0},seed)
        assert zero_wait['final']['mean_wait']==0
        zero_capacity=run('capacity',{**capacity['inputs']['baseline'],'queue_capacity':0},seed)
        assert zero_capacity['final']['rejected']>0
        rows.append(dict(repeat=repetition['repeat'],seed=seed,baseline=baseline,intervention=intervention,repaired=repaired,extension=extension))
# The declared upper bound does not silently truncate the last state.
upper=run('capacity',dict(customers=120,servers=1,arrival_rate=1.5,service_rate=1,max_wait=2,queue_capacity=120),4294967295)
print(json.dumps(dict(kind='offline-reference-domain-validation-not-benchmark-execution',failed=failed,repairedSha256=hashlib.sha256(base64.b64decode(fixtures['assets']['abandonment']['files'][0]['base64'])).hexdigest(),pythonVersion=sys.version.split()[0],pairedSeeds=len(rows),rows=rows,upperBound=upper)))
`],{stdio:['pipe','pipe','pipe']});let output='',error='';child.stdout.on('data',b=>output+=b);child.stderr.on('data',b=>error+=b);child.on('error',reject);child.on('close',code=>code===0?resolve(JSON.parse(output)):reject(Error(`offline-reference-python-exit-${code}: ${error}`)));child.stdin.end(JSON.stringify(input));});}
test('seeded bytes fail Python validation; repaired reference satisfies finite queue domains at every frozen seed',async()=>{const input=await frozen(),result=await python(input);assert.equal(result.kind,'offline-reference-domain-validation-not-benchmark-execution');assert.equal(result.failed.exception,'SyntaxError');assert.equal(result.failed.sha256,input.assets.seededFailure.sha256);assert.equal(result.repairedSha256,input.assets.seededFailure.repair.sha256);assert.equal(result.pairedSeeds,9);assert.ok(result.upperBound.frames<=501);for(const row of result.rows){assert.equal(row.baseline.final.completed,40);assert.equal(row.intervention.final.completed,40);assert.equal(row.repaired.final.completed+row.repaired.final.abandoned,40);assert.equal(row.extension.final.completed+row.extension.final.abandoned+row.extension.final.rejected,40);}});
