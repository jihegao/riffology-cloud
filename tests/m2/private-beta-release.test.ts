import test from 'node:test';
import assert from 'node:assert/strict';
import {privateBetaNativeReleaseGuard,privateBetaReleaseDeadline} from '../../services/model-budget/private-beta-release.ts';

test('only the original trusted absence guard qualifies; running, unconfirmed and recovery holds do not',()=>{
  const hold={turnId:'turn-a',status:'release-pending',reasonCode:'trusted-pi-release-assignment-guard'};
  assert.equal(privateBetaNativeReleaseGuard(hold,'turn-a'),true);
  assert.equal(privateBetaNativeReleaseGuard({...hold,reasonCode:'trusted-pi-release-quiet-window'},'turn-a'),true);
  for(const reasonCode of ['trusted-pi-release-running','trusted-pi-release-unconfirmed','trusted-pi-capacity-release-unconfirmed','project-workspace-release-unconfirmed'])assert.equal(privateBetaNativeReleaseGuard({...hold,reasonCode},'turn-a'),false);
  assert.equal(privateBetaNativeReleaseGuard({...hold,status:'recovery-hold'},'turn-a'),false);
  assert.equal(privateBetaNativeReleaseGuard(hold,'turn-b'),false);
  assert.equal(privateBetaNativeReleaseGuard(null,'turn-a'),false);
});

test('known native guard remains within the original total deadline; ordinary uncertainty retains the short deadline',()=>{
  const policy={maxTurnDurationMs:900000,releaseTimeoutMs:120000},createdAt=1000;
  const completed={terminal:true,finishedAt:121000};
  assert.equal(privateBetaReleaseDeadline(createdAt,policy,completed),241000);
  assert.equal(privateBetaReleaseDeadline(createdAt,policy,{...completed,releaseGuard:true}),901000);
  // Later projections cannot move the original guard deadline forward.
  assert.equal(privateBetaReleaseDeadline(createdAt,policy,{terminal:true,finishedAt:800000,releaseGuard:true}),901000);
  assert.equal(privateBetaReleaseDeadline(createdAt,policy,{terminal:false,finishedAt:null}),901000);
});
