import test from 'node:test';
import assert from 'node:assert/strict';
import {assertAppVersionDelta} from '../../scripts/ir-publication/core/publication.mjs';
const old={apps:[{id:'app',version:13,configuration:{image:'old'}}],appVersions:{app:[{version:13,percentage:100,configuration:{image:'old'}},{version:12,percentage:0,configuration:{image:'older'}}]}};
const next={apps:[{id:'app',version:14,configuration:{image:'new'}}],appVersions:{app:[{version:14,percentage:100,configuration:{image:'new'}},{version:13,percentage:0,configuration:{image:'old'}}]}};
test('accepted rolling version list retains previous current and new active',()=>assert.doesNotThrow(()=>assertAppVersionDelta(old,next,'app','new')));
test('missing previous current still stops',()=>{const n=structuredClone(next);n.appVersions.app.pop();assert.throws(()=>assertAppVersionDelta(old,n,'app','new'),/previous-current-app-version-missing/);});
test('retained history configuration drift still stops',()=>{const n=structuredClone(next);n.appVersions.app[1].configuration.image='changed';assert.throws(()=>assertAppVersionDelta(old,n,'app','new'),/old-app-version-data-drift/);});
test('unrelated app version family must remain exact',()=>{const b=structuredClone(old),n=structuredClone(next);b.appVersions.other=[{version:1}];n.appVersions.other=[];assert.throws(()=>assertAppVersionDelta(b,n,'app','new'),/other-app-version-family-drift/);});
