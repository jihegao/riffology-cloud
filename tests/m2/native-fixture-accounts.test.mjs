import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {spawnSync} from 'node:child_process';
const source=readFileSync(new URL('./trusted-pi-supervisor-host-files.mjs',import.meta.url),'utf8');
const account=source.slice(source.indexOf('function ensureTrustedPiAccount'),source.indexOf("const root="));
function piFixture({exists=true,uid='10002',gid='10002',primary='10002',lookupStatus=0}={}){let group=exists,user=exists;const created=[];const spawnSync=(command,args)=>{if(command==='getent'){if(lookupStatus)return {status:lookupStatus,stdout:''};const present=args[0]==='group'?group:user;return present?{status:0,stdout:args[0]==='group'?`trustedpi:x:${gid}:\n`:`trustedpi:x:${uid}:${primary}:fixture:/nonexistent:/usr/sbin/nologin\n`}:{status:2,stdout:''};}created.push(command);if(command==='groupadd')group=true;else if(command==='useradd')user=true;else assert.fail(command);return {status:0};};return {created,run:()=>vm.runInNewContext(account+';ensureTrustedPiAccount();',{assert,spawnSync})};}
test('Pi fixture reuses only the exact existing account and creates missing accounts',()=>{const existing=piFixture();existing.run();assert.deepEqual(existing.created,[]);const absent=piFixture({exists:false});absent.run();assert.deepEqual(absent.created,['groupadd','useradd']);});
test('Pi fixture rejects UID, GID, primary-group mismatch and lookup failure',()=>{for(const options of [{uid:'0'},{gid:'0'},{primary:'0'},{lookupStatus:1}])assert.throws(()=>piFixture(options).run());});
test('Project fixture account setup creates absent account, validates existing identity and rejects mismatches',()=>{
 const script=`import ast,types,sys
source=open(sys.argv[1]).read(); function=next(n for n in ast.parse(source).body if isinstance(n,ast.FunctionDef) and n.name=='ensure_project_account')
for exists,uid,gid,primary in [(True,10001,10001,10001),(False,10001,10001,10001),(True,0,10001,10001),(True,10001,0,10001),(True,10001,10001,0)]:
 state={'group':exists,'user':exists}; calls=[]
 def group(key):
  if not state['group']: raise KeyError(key)
  return types.SimpleNamespace(gr_gid=gid,gr_name='project')
 def user(key):
  if not state['user']: raise KeyError(key)
  return types.SimpleNamespace(pw_uid=uid,pw_gid=primary,pw_name='project')
 def run(args,check):
  assert check; calls.append(args[0]); state['group' if args[0]=='groupadd' else 'user']=True
 env={'grp':types.SimpleNamespace(getgrnam=group,getgrgid=group),'pwd':types.SimpleNamespace(getpwnam=user,getpwuid=user),'subprocess':types.SimpleNamespace(run=run)}
 exec(compile(ast.Module(body=[function],type_ignores=[]),'fixture-account','exec'),env)
 try: env['ensure_project_account'](); assert (uid,gid,primary)==(10001,10001,10001)
 except RuntimeError: assert (uid,gid,primary)!=(10001,10001,10001)
 if exists: assert calls==[]
 else: assert calls==['groupadd','useradd']
`;
 const result=spawnSync('python3',['-c',script,new URL('./project_epoch_native.py',import.meta.url).pathname],{encoding:'utf8'});assert.equal(result.status,0,result.stderr);
});
