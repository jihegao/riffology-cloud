/** Offline evidence qualification only. This module does not authenticate cloud receipts. */
export function qualifyRuntimeObservation(value) {
  const errors=[];
  const require=(condition,code)=>{if(!condition)errors.push(code);};
  const id=value=>typeof value==='string'&&value.length>0;
  const hash=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
  require(value?.schemaVersion===1,'schema-version');
  require(value?.kind==='g5-runtime-observation','observation-kind');
  require(value?.transport==='production','production-transport-required');
  require(value?.observed===true,'actual-observation-required');
  const frozen=value?.frozen;
  require(/^[a-f0-9]{40}$/.test(frozen?.sourceSha??''),'frozen-source-required');
  for(const key of ['workerVersionId','projectImageDigest','piImageDigest','runtimeVersion'])require(id(frozen?.[key]),`frozen-${key}-required`);
  require(hash(frozen?.runtimeVersion),'runtime-version-invalid');
  require(frozen?.deploymentPercent===100,'full-deployment-required');
  const turns=Array.isArray(value?.turns)?value.turns:[];
  require(turns.length===10,'ten-turns-required');
  const seen=new Map();
  const unique=(field,item,index)=>{require(id(item),`turn-${index}-${field}-required`);const set=seen.get(field)??new Set();require(!set.has(item),`turn-${index}-${field}-reused`);set.add(item);seen.set(field,set);};
  turns.forEach((turn,index)=>{
    const n=index+1,first=turns[0];
    for(const field of ['tenantId','workspaceId','leaseId','pairId','projectPhysicalId','piPhysicalId'])require(id(turn?.[field]),`turn-${n}-${field}-required`);
    for(const field of ['generation','leaseEpoch'])require(Number.isSafeInteger(turn?.[field])&&turn[field]>0,`turn-${n}-${field}-required`);
    for(const field of ['turnId','dispatchId','tokenId','projectPidStartIdentity','piPidStartIdentity'])unique(field,turn?.[field],n);
    for(const field of ['tenantId','workspaceId','generation','leaseId','pairId','projectPhysicalId','piPhysicalId','leaseEpoch','runtimeVersion'])require(turn?.[field]!==undefined&&turn[field]===first?.[field],`turn-${n}-${field}-mismatch`);
    require(turn?.runtimeVersion===frozen?.runtimeVersion,`turn-${n}-runtime-version-mismatch`);
    require(turn?.bindingEpoch===n,`turn-${n}-binding-epoch`);
    require(id(turn?.sessionId)&&turn.sessionId===(index<5?first?.sessionId:turns[5]?.sessionId),`turn-${n}-session-chain`);
    if(index===5)require(turn.sessionId!==first?.sessionId,'session-switch-required');
    require(turn?.outcome==='completed'&&turn?.savedByRevisionStore===true&&turn?.savedByWorkspace===true,`turn-${n}-checkpoint-not-saved`);
    for(const field of ['revisionSha256','filesSha256','sessionSha256'])require(hash(turn?.[field]),`turn-${n}-${field}-required`);
    const ledgers=turn?.ledgers;
    for(const domain of ['tokens','money','tools']){
      const ledger=ledgers?.[domain];
      require(ledger?.closed===true&&ledger.active===0&&ledger.pending===0&&ledger.unknown===0,`turn-${n}-${domain}-not-closed`);
      for(const field of ['tenantId','workspaceId','generation','turnId','dispatchId'])require(ledger?.[field]!==undefined&&ledger[field]===turn?.[field],`turn-${n}-${domain}-${field}-mismatch`);
      require(id(ledger?.receiptId),`turn-${n}-${domain}-receipt-required`);
    }
    require(hash(turn?.rawEvidenceSha256),`turn-${n}-raw-evidence-required`);
  });
  const release=value?.release;
  for(const domain of ['project','pi']){
    const guard=release?.[domain];
    require(guard?.status==='released'&&guard?.unknown===0&&guard?.physicalAbsent===true,`${domain}-release-unconfirmed`);
    require(guard?.physicalId===turns[0]?.[domain==='project'?'projectPhysicalId':'piPhysicalId']&&id(guard?.physicalId),`${domain}-release-physical-mismatch`);
    require(Number.isSafeInteger(guard?.guardBegunAt)&&Number.isSafeInteger(guard?.observedAt)&&guard.observedAt-guard.guardBegunAt>=360000,`${domain}-assignment-guard-required`);
    require(Number.isSafeInteger(guard?.quietBegunAt)&&Number.isSafeInteger(guard?.observedAt)&&guard.quietBegunAt>=guard.guardBegunAt&&guard.observedAt-guard.quietBegunAt>=30000,`${domain}-quiet-interval-required`);
    require(hash(guard?.rawEvidenceSha256),`${domain}-raw-evidence-required`);
  }
  return {schemaVersion:1,status:errors.length?'blocked':'qualified',qualificationOnly:true,cloudAcceptance:false,reasonCodes:[...new Set(errors)],turns:turns.length};
}
