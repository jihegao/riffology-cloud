import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {chmodSync,mkdirSync,mkdtempSync,readFileSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test from 'node:test';
import {AUTH_SOURCE_SECRETS,CONTAINER_CLASSES,LOCAL_GENERATED_SECRETS,LOCAL_OAUTH_EGRESS_SECRET,PRODUCT_TOOL_BRIDGE_SHA256,RUNTIME_KEYS,SANDBOX_CONTAINER_CLASSES,areLoopbackAddresses,buildLaunchConfig,catalogAdmissionFromWrangler,dockerCapacityFromInfo,isAllowedDockerReference,runVerticalPreflight,validateRuntimeFile,validateSecretSources,validateTls,verticalModelBudgetState} from '../../scripts/m3/vertical-runtime-preflight.mjs';

const imageDigest=value=>'sha256:'+value.repeat(64).slice(0,64);
const containerImages=()=>Object.fromEntries(CONTAINER_CLASSES.map((name,index)=>[name,{reference:`docker.io/library/riffology-${name.toLowerCase()}:test`,digest:imageDigest(String(index+1))}]));
const validProfile=()=>{const images=containerImages();return {APP_ORIGIN:'https://app.local.riffology.gaojihe.cn:8797',M3_PREVIEW_ORIGIN:'https://preview.local.riffology.gaojihe.cn:8797',CONTAINER_IMAGES:images,M3_SERVICE_IMAGE:'local/riffology-service@'+images.ServiceSandbox.digest,HTTPS_CERT_PATH:'private/cert.pem',HTTPS_KEY_PATH:'private/key.pem',M2_TURNS_ENABLED:'true',M2_MODEL_PROVIDER_ENABLED:'true',M3_SERVICE_ENABLED:'true',M3_PREVIEW_ENABLED:'true',M3_PREVIEW_WS_ENABLED:'true',M3_OBSERVER_ENABLED:'false'};};

test('vertical runtime preflight proves topology while missing private inputs block before launch',()=>{
  const result=runVerticalPreflight({system:false});
  assert.equal(result.status,'blocked');
  assert.ok(result.checks.filter(value=>['product-config','execution-defaults-closed','vertical-bindings','vertical-exports','service-container','preview-route-migration'].includes(value.name)).every(value=>value.status==='passed'));
  assert.deepEqual(result.checks.filter(value=>value.status==='blocked').map(value=>value.name),['runtime-secrets','runtime-profile','oauth-redirect']);
});

test('registered public-suffix loopback profile accepts its exact Google callback',()=>{
  const directory=mkdtempSync(join(tmpdir(),'riffology-vertical-oauth-')),runtime=join(directory,'runtime.json'),profile=validProfile();writeFileSync(runtime,JSON.stringify(profile));
  const result=runVerticalPreflight({runtimeFile:runtime,system:false});assert.equal(result.checks.find(value=>value.name==='oauth-redirect').status,'passed');
});

test('private credentials and fixed images generate the complete launch topology',()=>{
  const directory=mkdtempSync(join(tmpdir(),'riffology-vertical-preflight-')),auth=join(directory,'auth.json'),internal=join(directory,'internal.json'),opencode=join(directory,'opencode.json'),runtime=join(directory,'runtime.json');
  writeFileSync(auth,JSON.stringify(Object.fromEntries(AUTH_SOURCE_SECRETS.map(name=>[name,'x'.repeat(40)]))),{mode:0o600});writeFileSync(internal,JSON.stringify(Object.fromEntries(LOCAL_GENERATED_SECRETS.map(name=>[name,'y'.repeat(40)]))),{mode:0o600});writeFileSync(opencode,JSON.stringify({'opencode-go':{type:'api',key:'z'.repeat(40)}}),{mode:0o600});
  const profile=validProfile();assert.deepEqual(Object.keys(profile).sort(),[...RUNTIME_KEYS].sort());writeFileSync(runtime,JSON.stringify(profile));
  assert.equal(validateSecretSources([auth,internal],opencode).status,'passed');assert.equal(validateRuntimeFile(runtime).check.status,'passed');
  const lockedImages=join(directory,'locked-images');mkdirSync(lockedImages);
  const base=JSON.parse(readFileSync(new URL('../../infra/wrangler.m2-product-local.jsonc',import.meta.url),'utf8')),generated=buildLaunchConfig(base,profile,lockedImages);
  assert.equal(generated.vars.M2_TURNS_ENABLED,'true');assert.equal(generated.vars.M3_SERVICE_ENABLED,'true');assert.equal(generated.vars.M3_PREVIEW_ENABLED,'true');assert.equal(generated.vars.M3_VERTICAL_MODEL_TELEMETRY,'true');assert.equal(generated.vars.M3_VERTICAL_PREVIEW_TELEMETRY,'true');
  assert.equal(generated.vars.M2_MODEL_BUDGET_POLICY_VERSION,'m2-token-vertical-v2');assert.equal(generated.vars.MODEL_BUDGET_POLICY_VERSION,'m2-token-vertical-v2');assert.equal(generated.vars.MODEL_BUDGET_MAX_RESERVATION_ATTEMPTS_PER_TURN,'8');assert.equal(generated.vars.MODEL_BUDGET_MAX_DISPATCHED_CALLS_PER_TURN,'8');
  assert.deepEqual(generated.secrets.required,[...base.secrets.required,LOCAL_OAUTH_EGRESS_SECRET]);assert.equal(base.secrets.required.includes(LOCAL_OAUTH_EGRESS_SECRET),false);
  assert.deepEqual(generated.containers.map(value=>value.image),CONTAINER_CLASSES.map(name=>join(lockedImages,`${name}.Dockerfile`)));assert.ok(generated.containers.every(value=>value.image_build_context===lockedImages));
  for(const name of CONTAINER_CLASSES){const image=profile.CONTAINER_IMAGES[name],immutable=`${image.reference.replace(/:[^/:]+$/,'')}@${image.digest}`,pools=SANDBOX_CONTAINER_CLASSES.includes(name)?'ENV PYTHON_POOL_MIN_SIZE=0 JAVASCRIPT_POOL_MIN_SIZE=0 TYPESCRIPT_POOL_MIN_SIZE=0\n':'';assert.equal(readFileSync(join(lockedImages,`${name}.Dockerfile`),'utf8'),`FROM ${immutable}\n${pools}`);}
  assert.equal(base.vars.M2_TURNS_ENABLED,'false');assert.equal(base.containers.find(value=>value.class_name==='ServiceSandbox').image,'../services/run/Dockerfile.service');
});

test('locally generated secrets stay valid while an existing auth source is still required',()=>{
  const directory=mkdtempSync(join(tmpdir(),'riffology-vertical-local-secrets-')),secrets=join(directory,'secrets.json');
  writeFileSync(secrets,JSON.stringify(Object.fromEntries(LOCAL_GENERATED_SECRETS.map(name=>[name,'x'.repeat(40)]))),{mode:0o600});
  const result=validateSecretSources([secrets],null);assert.equal(result.status,'blocked');assert.equal(result.detail,`missing-existing-auth-secrets:${AUTH_SOURCE_SECRETS.join(',')}`);
});

test('runtime profile rejects HTTP control, deferred Observer, and an unbound service digest',()=>{
  const directory=mkdtempSync(join(tmpdir(),'riffology-vertical-preflight-invalid-')),runtime=join(directory,'runtime.json'),profile=validProfile();
  profile.APP_ORIGIN='http://127.0.0.1:8797';profile.M3_OBSERVER_ENABLED='true';profile.M3_SERVICE_IMAGE='local/riffology-service@sha256:'+'f'.repeat(64);
  writeFileSync(runtime,JSON.stringify(profile));assert.equal(validateRuntimeFile(runtime).check.status,'failed');
});

test('runtime image references allow an exact loopback registry and reject non-loopback registries',()=>{
  assert.equal(isAllowedDockerReference('docker.io/library/riffology-trusted-pi:local'),true);
  assert.equal(isAllowedDockerReference('127.0.0.1:5000/riffology-trusted-pi:local'),true);
  assert.equal(isAllowedDockerReference('127.0.0.1:65536/riffology-trusted-pi:local'),false);
  assert.equal(isAllowedDockerReference('localhost:5000/riffology-trusted-pi:local'),false);
  assert.equal(isAllowedDockerReference('192.0.2.1:5000/riffology-trusted-pi:local'),false);
});

test('vertical ProjectTool image declares the exact platform deny-all fallback marker',()=>{
  const dockerfile=readFileSync(new URL('../../services/project-tools/Dockerfile.vertical',import.meta.url),'utf8');
  assert.match(dockerfile,/^ENV RIFFOLOGY_PROJECT_PLATFORM_EGRESS_FENCE=workerd-deny-all-v1$/m);
  assert.match(dockerfile,/cloudflare\/sandbox:0\.12\.9-python@sha256:[a-f0-9]{64}/);
});
test('vertical Service image declares the exact platform deny-all fallback marker',()=>{
  const dockerfile=readFileSync(new URL('../../services/run/Dockerfile.vertical',import.meta.url),'utf8');
  assert.match(dockerfile,/^ENV RIFFOLOGY_SERVICE_PLATFORM_EGRESS_FENCE=workerd-deny-all-v1$/m);
  assert.match(dockerfile,/cloudflare\/sandbox:0\.12\.9-python@sha256:[a-f0-9]{64}/);
});

test('vertical TrustedPi release preflight binds the image to the checked-out Tool Bridge source',()=>{
  const source=readFileSync(new URL('../../services/trusted-pi/product-tool-bridge.mjs',import.meta.url));
  assert.equal(PRODUCT_TOOL_BRIDGE_SHA256,createHash('sha256').update(source).digest('hex'));
  const preflight=readFileSync(new URL('../../scripts/m3/vertical-runtime-preflight.mjs',import.meta.url),'utf8');
  assert.match(preflight,/product-tool-bridge\.mjs/);
  assert.match(preflight,/bridgeSha!==/);
});

test('vertical model loop budget accepts only an idle exact base-to-vertical migration',()=>{
  const base={policy_version:'m2-token-v1',max_reservation_attempts_per_turn:4,max_dispatched_calls_per_turn:2,max_input_tokens_per_call:262144,max_output_tokens_per_call:4096,max_reserved_tokens_per_turn:532480,active_calls:0};
  assert.deepEqual(verticalModelBudgetState(base),{ok:true,migration:true});
  assert.deepEqual(verticalModelBudgetState({...base,policy_version:'m2-token-vertical-v1',max_reservation_attempts_per_turn:6,max_dispatched_calls_per_turn:6}),{ok:true,migration:true});
  assert.deepEqual(verticalModelBudgetState({...base,policy_version:'m2-token-vertical-v2',max_reservation_attempts_per_turn:8,max_dispatched_calls_per_turn:8}),{ok:true,migration:false});
  assert.equal(verticalModelBudgetState({...base,active_calls:1}).ok,false);
  assert.equal(verticalModelBudgetState({...base,max_reserved_tokens_per_turn:532481}).ok,false);
});

test('DNS guard rejects any mixed non-loopback answer',()=>{
  assert.equal(areLoopbackAddresses([{address:'127.0.0.1',family:4},{address:'::1',family:6}]),true);
  assert.equal(areLoopbackAddresses([{address:'127.0.0.1',family:4},{address:'192.0.2.1',family:4}]),false);
  assert.equal(areLoopbackAddresses([]),false);
});
test('Docker capacity blocks undersized cross-architecture local runtimes with an actionable Colima target',()=>{
  const runtime=validProfile();
  assert.equal(dockerCapacityFromInfo({Architecture:'aarch64',MemTotal:2*1024**3},runtime,'arm64').status,'blocked');
  assert.match(dockerCapacityFromInfo({Architecture:'aarch64',MemTotal:2*1024**3},runtime,'arm64').detail,/at-least-4GiB.*colima-stop-then-colima-start---memory-4/);
  assert.equal(dockerCapacityFromInfo({Architecture:'aarch64',MemTotal:4*1024**3},runtime,'arm64').status,'passed');
  assert.equal(dockerCapacityFromInfo({Architecture:'aarch64',MemTotal:Math.floor(3.8*1024**3)},runtime,'arm64').status,'passed');
  assert.equal(dockerCapacityFromInfo({Architecture:'x86_64',MemTotal:2*1024**3},runtime,'x64').status,'passed');
});
test('catalog admission accepts formal state and points an empty catalog to operator bootstrap',()=>{
  assert.equal(catalogAdmissionFromWrangler({status:0,stdout:JSON.stringify([{success:true,results:[{ready:1}]}])}).status,'passed');
  const empty=catalogAdmissionFromWrangler({status:0,stdout:JSON.stringify([{success:true,results:[{ready:0}]}])});
  assert.equal(empty.status,'blocked');assert.match(empty.detail,/scripts\/m1\/bootstrap-operator\.mjs invite --email <authorized-email>.*--persist-to \.local\/m3-vertical-runtime/);
  assert.equal(catalogAdmissionFromWrangler({status:1,stdout:''}).detail,'apply-local-catalog-migrations-before-preflight');
});

test('TLS guard rejects a valid private key that does not match the certificate',()=>{
  const directory=mkdtempSync(join(tmpdir(),'riffology-vertical-tls-')),cert=join(directory,'cert.pem'),certKey=join(directory,'cert-key.pem'),otherKey=join(directory,'other-key.pem');
  const generated=spawnSync('openssl',['req','-x509','-newkey','rsa:2048','-nodes','-days','1','-subj','/CN=app.local.riffology.gaojihe.cn','-addext','subjectAltName=DNS:app.local.riffology.gaojihe.cn,DNS:*.preview.local.riffology.gaojihe.cn','-keyout',certKey,'-out',cert],{encoding:'utf8'});assert.equal(generated.status,0,generated.stderr);
  const other=spawnSync('openssl',['genpkey','-algorithm','RSA','-pkeyopt','rsa_keygen_bits:2048','-out',otherKey],{encoding:'utf8'});assert.equal(other.status,0,other.stderr);chmodSync(otherKey,0o600);
  const profile=validProfile();profile.HTTPS_CERT_PATH=cert;profile.HTTPS_KEY_PATH=otherKey;
  const checks=validateTls(directory,profile);assert.equal(checks.find(value=>value.name==='tls-private-key').status,'passed');assert.equal(checks.find(value=>value.name==='tls-key-match').status,'failed');
});
