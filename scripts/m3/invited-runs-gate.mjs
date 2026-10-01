import {invitedRunsPolicy} from '../../services/simulation/invited-policy.ts';

/** Historical release workflows never authorize the independent invited Run
 * route. Close only its admission bit, retaining its original policy/actor and
 * resource limits so history, observation and release remain available. */
export function closeInvitedRunsAdmission(config){
 const raw=config.vars?.INVITED_RUNS_POLICY_JSON;
 if(raw===undefined)return config;
 if(typeof raw!=='string')throw Error('invited-runs-policy-invalid');
 const policy=invitedRunsPolicy(raw);
 if(policy.enabled)config.vars.INVITED_RUNS_POLICY_JSON=JSON.stringify({...policy,enabled:false});
 return config;
}
export function invitedRunsAdmissionClosed(vars){
 try{return vars?.INVITED_RUNS_POLICY_JSON===undefined||typeof vars.INVITED_RUNS_POLICY_JSON==='string'&&invitedRunsPolicy(vars.INVITED_RUNS_POLICY_JSON)?.enabled===false;}catch{return false;}
}
export function deployedInvitedRunsAdmissionClosed(bindings){
 const policies=bindings.filter(binding=>binding?.name==='INVITED_RUNS_POLICY_JSON');
 return policies.length===0||policies.length===1&&policies[0].type==='plain_text'&&invitedRunsAdmissionClosed({INVITED_RUNS_POLICY_JSON:policies[0].text});
}
