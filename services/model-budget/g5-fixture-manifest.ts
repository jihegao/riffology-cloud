export const G5_FIXTURE_MANIFEST_SHA256='673d0cbe930990602649aaa9d746e16ad29280981f5f7be336b368388ceee753';
export const G5_TRACE_AUDIT_CONTRACT=Object.freeze({schemaVersion:1 as const,path:'trace-audit.json' as const,maxBytes:16384 as const,columns:Object.freeze(['frame','time','queue_length','completed','abandoned','rejected','active','waiting'] as const)});
export const G5_FIXTURE_RUNS=[1,2,1,1,6,2] as const;
export const G5_FIXTURE_CATEGORIES=['create-model','parameter-change','mechanism-change','repair-validation','measured-evidence','reopen-continue'] as const;
export type G5FixtureCategory=typeof G5_FIXTURE_CATEGORIES[number];
const seeds=[[104729,104759,104761],[130363,130367,130369],[155921,155927,155929]] as const;
const base={arrival_rate:0.8,customers:40,servers:1,service_rate:1},overloaded={arrival_rate:1.5,customers:40,max_wait:2,servers:1,service_rate:1},zeroWait={arrival_rate:1.5,customers:40,max_wait:0,servers:1,service_rate:1};
const inputs={
 'create-model':[base],'parameter-change':[base,{arrival_rate:1.2,customers:40,servers:1,service_rate:1}],
 'mechanism-change':[zeroWait],'repair-validation':[overloaded],
 'measured-evidence':[overloaded,{arrival_rate:1.5,customers:40,max_wait:2,servers:2,service_rate:1}],
 'reopen-continue':[{arrival_rate:1.5,customers:40,max_wait:2,queue_capacity:120,servers:1,service_rate:1},{arrival_rate:1.5,customers:40,max_wait:2,queue_capacity:0,servers:1,service_rate:1}]
} as const;
const relations={
 'create-model':'created','parameter-change':'unchanged','mechanism-change':'changed','repair-validation':'restored-after-same-turn-failure','measured-evidence':'unchanged','reopen-continue':'changed'
} as const;
const unsupported:Record<G5FixtureCategory,readonly string[]>={'create-model':[],'parameter-change':[],'mechanism-change':[],'repair-validation':[],'measured-evidence':[],'reopen-continue':[]};
const machineChecks:Record<G5FixtureCategory,readonly string[]>={
 'create-model':['finite nonnegative trace audit','final completed equals customers and final active equals zero','queue_length equals waiting in every audit row'],
 'parameter-change':['both trace audits are finite and nonnegative','both final completed values equal customers and final active values equal zero','queue_length equals waiting in every audit row','paired higher-arrival-rate mean_wait is no smaller than baseline'],
 'mechanism-change':['finite trace audit and final completed plus abandoned equals customers','abandonment count is nonzero','max_wait equals zero and mean_wait equals zero','queue_length equals waiting in every audit row'],
 'repair-validation':['finite trace audit and final completed plus abandoned equals customers','saved repair source excludes the seeded failure bytes','queue_length equals waiting in every audit row'],
 'measured-evidence':['six child trace audits are finite and conserve customers','group contains exact two configurations by three seeds','verified throughput delta references all six result artifacts'],
 'reopen-continue':['finite trace audits and final completed plus abandoned plus rejected equals customers','queue_length never exceeds queue_capacity','zero-capacity intervention has rejected greater than zero and queue_length zero in every row','prior results remain historical under the new revision']
};
const unassessedChecks:Record<G5FixtureCategory,readonly string[]>={'create-model':[],'parameter-change':[],'mechanism-change':[],'repair-validation':[],'measured-evidence':['natural-language interpretation is unassessed'],'reopen-continue':['natural-language interpretation is unassessed']};
export type G5FixtureManifestEntry={fixtureId:string;category:G5FixtureCategory;repeat:number;sequence:number;order:number;dependsOn:string|null;sourceRelation:typeof relations[G5FixtureCategory];runCount:number;mode:'individual'|'group';expectedRuns:readonly {parameters:Record<string,number>;seed:number}[];machineChecks:readonly string[];unassessedChecks:readonly string[];unsupportedChecks:readonly string[]};
export const G5_FIXTURE_MANIFEST:readonly G5FixtureManifestEntry[]=Object.freeze([1,2,3].flatMap(repeat=>G5_FIXTURE_CATEGORIES.map((category,index)=>{const paired=seeds[repeat-1]!,parameters=inputs[category],expectedRuns=category==='measured-evidence'?parameters.flatMap(value=>paired.map(seed=>({parameters:{...value},seed}))):parameters.map(value=>({parameters:{...value},seed:paired[0]}));return Object.freeze({fixtureId:`queue-r${repeat}-${index+1}-${category}`,category,repeat,sequence:index+1,order:(repeat-1)*6+index+1,dependsOn:index===0?null:`queue-r${repeat}-${index}-${G5_FIXTURE_CATEGORIES[index-1]}`,sourceRelation:relations[category],runCount:G5_FIXTURE_RUNS[index],mode:category==='measured-evidence'?'group':'individual',expectedRuns,machineChecks:machineChecks[category],unassessedChecks:unassessedChecks[category],unsupportedChecks:unsupported[category]});})));
export function g5FixtureManifestEntry(fixtureId:string){const entry=G5_FIXTURE_MANIFEST.find(value=>value.fixtureId===fixtureId);if(!entry)throw Error('g5-authority-fixture-invalid');return entry;}
type FixtureClaim={createdBy:unknown;kind:string;metric:string;experimentId:string;armId:string|null;count:number;baselineCount:number;plannedCount:number;references:{runId:string;armId:string|null}[]};
export function g5FixtureClaimContract(claims:FixtureClaim[],runIds:string[],groupId:string|null,actor:unknown){
 if(claims.some(claim=>claim.metric!=='throughput'||JSON.stringify(claim.createdBy)!==JSON.stringify(actor)||claim.references.length<1||claim.references.some(reference=>!runIds.includes(reference.runId))))throw Error('g5-fixture-claim-authority-unsettled');
 const coverage=claims.flatMap(claim=>claim.references.map(reference=>reference.runId)).sort();if(JSON.stringify(coverage)!==JSON.stringify([...runIds].sort()))throw Error('g5-fixture-claim-coverage-mismatch');
 if(groupId===null){if(claims.length!==runIds.length||claims.some(claim=>claim.kind!=='run'||claim.references.length!==1||claim.experimentId!==claim.references[0]!.runId))throw Error('g5-fixture-claim-contract-mismatch');return;}
 const claim=claims[0],arms=[...new Set(claim?.references.map(reference=>reference.armId))].sort();if(claims.length!==1||claim?.kind!=='delta'||claim.experimentId!==groupId||claim.armId!=='intervention-1'||claim.count!==3||claim.baselineCount!==3||claim.plannedCount!==6||JSON.stringify(arms)!==JSON.stringify(['baseline','intervention-1']))throw Error('g5-fixture-claim-contract-mismatch');
}
