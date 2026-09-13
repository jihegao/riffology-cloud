import {ServiceSandbox} from '../run/service-sandbox.ts';
/** One isolated immutable finite Run per actor. No Pi or project credentials. */
export class SimulationSandbox extends ServiceSandbox{}
SimulationSandbox.outbound=async()=>new Response('simulation-egress-denied',{status:403});
