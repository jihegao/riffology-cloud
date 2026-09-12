/** Runs the two cron domains concurrently so a provisioning read failure cannot
 * prevent Revision GC from receiving its independent maintenance delivery. */
export async function runGatewayScheduledDomains(provisioning:()=>Promise<void>,revisionGc:()=>Promise<void>):Promise<void>{
  const [provisioningResult,gcResult]=await Promise.allSettled([Promise.resolve().then(provisioning),Promise.resolve().then(revisionGc)]);
  if(provisioningResult.status==='rejected')throw Error('workspace-dispatch-incomplete');
  if(gcResult.status==='rejected')throw Error('revision-gc-maintenance-incomplete');
}
