import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';

const root=new URL('../../scripts/m3/offline-view/',import.meta.url);
const sha256=bytes=>createHash('sha256').update(bytes).digest('hex');
const baselineCanonical='4dc1298afa7676147c1320afa42d72691fc55379ae762b392b56853574a7a38a';

test('offline Chromium policy changes only two rules in the pinned Moby baseline',async()=>{
 const bytes=await readFile(new URL('chromium-userns-seccomp.json',root));
 const provenance=JSON.parse(await readFile(new URL('seccomp-provenance.json',root),'utf8'));
 assert.equal(provenance.baseline.commit,'245180c51918481c0525424b3ee025d2b435d46c');
 assert.equal(provenance.baseline.rawSha256,'785b2429264afba4d594320337cb17f144f3c7d51585f9805eef72e28f4f9334');
 assert.equal(provenance.baseline.canonicalSha256,baselineCanonical);
 assert.equal(sha256(bytes),provenance.profile.sha256);
 const profile=JSON.parse(bytes),chroot=profile.syscalls.pop(),extra=profile.syscalls.pop();
 assert.deepEqual(extra.names,['clone','setns','unshare']);
 assert.equal(extra.action,'SCMP_ACT_ALLOW');
 assert.deepEqual(extra.args,[]);assert.deepEqual(extra.includes,{});assert.deepEqual(extra.excludes,{});
 assert.deepEqual(chroot.names,['chroot']);assert.equal(chroot.action,'SCMP_ACT_ALLOW');
 assert.deepEqual(chroot.args,[]);assert.deepEqual(chroot.includes,{});assert.deepEqual(chroot.excludes,{});
 assert.equal(sha256(JSON.stringify(profile)),baselineCanonical,'no other baseline fields or rules may change');
});

test('offline policy retains default deny, clone3 ENOSYS and capability guards',async()=>{
 const profile=JSON.parse(await readFile(new URL('chromium-userns-seccomp.json',root),'utf8'));
 assert.equal(profile.defaultAction,'SCMP_ACT_ERRNO');assert.equal(profile.defaultErrnoRet,1);
 assert(profile.syscalls.some(rule=>rule.names.includes('clone3')&&rule.action==='SCMP_ACT_ERRNO'&&rule.errnoRet===38&&rule.excludes?.caps?.includes('CAP_SYS_ADMIN')));
 // At profile-load time, the launcher's cap-drop=ALL excludes rules requiring
 // an outer capability. Child user-namespace capabilities are distinct.
 // This is static policy verification, not a
 // syscall probe or a claim that a host's libseccomp accepted the profile.
 const possibleWithoutCaps=profile.syscalls.filter(rule=>rule.action==='SCMP_ACT_ALLOW'&&!rule.includes?.caps?.length);
 for(const syscall of ['clone3','mount','umount2','bpf','io_uring_setup','io_uring_enter','io_uring_register'])assert(!possibleWithoutCaps.some(rule=>rule.names.includes(syscall)),syscall);
});
