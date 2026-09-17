/** Token shape only. Call identity, immutable receipt digest, closed source,
 * unchanged money hold and empty tools are checked by the rollover authority. */
export function rolloverTokenMatches(token:{status:string;reconciliation:string;terminal:null|{errorCode:string|null;usage:{kind:string};providerRequestIdPresent:boolean}},state?:'failed-pending'):boolean{
 if(token.reconciliation!=='pending')return false;
 if(state===undefined)return token.status==='unknown'&&token.terminal===null;
 return state==='failed-pending'&&token.status==='failed'&&token.terminal!==null
  &&token.terminal.errorCode==='provider-failure'&&token.terminal.usage.kind==='unknown'
  &&token.terminal.providerRequestIdPresent===true;
}
