import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';
import {inspectManagedImage,validateStagingTopology} from '../../scripts/m3/vertical-staging-preflight.mjs';

const config=()=>JSON.parse(readFileSync(new URL('../../infra/wrangler.m3-vertical-staging.jsonc',import.meta.url),'utf8'));
const migrations=()=>readdirSync(new URL('../../services/catalog/migrations',import.meta.url)).filter(name=>name.endsWith('.sql'));

test('staging vertical topology is complete, immutable and initially closed',()=>{
  const checks=validateStagingTopology(config(),migrations());
  assert.equal(checks.length,15);
  assert.deepEqual(checks.filter(value=>value.status!=='passed'),[]);
});

test('staging topology rejects early execution, local images and storage sharing',()=>{
  const value=config();
  value.vars.M2_TURNS_ENABLED='true';
  value.containers[1].image='127.0.0.1:5000/project:latest';
  value.r2_buckets[1].bucket_name=value.r2_buckets[0].bucket_name;
  const failed=new Set(validateStagingTopology(value,migrations()).filter(item=>item.status!=='passed').map(item=>item.name));
  assert.deepEqual(failed,new Set(['execution-gates-closed','container-images','dedicated-storage','no-local-runtime-inputs']));
});

test('managed image inspection binds exact manifest and linux amd64 config',async()=>{
  const digest=`sha256:${'a'.repeat(64)}`,configDigest=`sha256:${'b'.repeat(64)}`;
  const reference=`registry.cloudflare.com/8b0d70250211aa10d89e20605a1c7e5e/project@${digest}`;
  const calls=[];
  const fetcher=async url=>{
    calls.push(url);
    if(url.endsWith(`/manifests/${digest}`))return new Response(JSON.stringify({config:{digest:configDigest}}),{status:200,headers:{'docker-content-digest':digest}});
    if(url.endsWith(`/blobs/${configDigest}`))return new Response(JSON.stringify({os:'linux',architecture:'amd64'}),{status:200});
    return new Response('',{status:404});
  };
  assert.deepEqual(await inspectManagedImage(reference,'x'.repeat(32),fetcher),{digest,os:'linux',architecture:'amd64'});
  assert.equal(calls.length,2);
});

test('managed image inspection fails closed on digest or platform drift',async()=>{
  const digest=`sha256:${'c'.repeat(64)}`,configDigest=`sha256:${'d'.repeat(64)}`;
  const reference=`registry.cloudflare.com/8b0d70250211aa10d89e20605a1c7e5e/project@${digest}`;
  await assert.rejects(()=>inspectManagedImage(reference,'x'.repeat(32),async()=>new Response('{}',{status:200,headers:{'docker-content-digest':`sha256:${'e'.repeat(64)}`}})),/managed-image-digest-mismatch/);
  const fetcher=async url=>url.includes('/manifests/')?new Response(JSON.stringify({config:{digest:configDigest}}),{status:200,headers:{'docker-content-digest':digest}}):new Response(JSON.stringify({os:'linux',architecture:'arm64'}),{status:200});
  await assert.rejects(()=>inspectManagedImage(reference,'x'.repeat(32),fetcher),/managed-image-platform-mismatch/);
});

test('generated local Wrangler profiles are ignored without hiding staging config',()=>{
  const ignore=readFileSync(new URL('../../.gitignore',import.meta.url),'utf8');
  assert.match(ignore,/^infra\/\.vertical-runtime-\*\.jsonc$/m);
  assert.doesNotMatch(ignore,/wrangler\.m3-vertical-staging/);
});
