/** Single fixed owner entry; default disabled. No runtime patch/materialization. */
import {runBoundOwner,preparationStatus} from './owner-runtime.mjs';
import {need,safeCode} from './local-guards.mjs';
const controller=new AbortController();let signalSeen=false;
for(const name of ['SIGINT','SIGTERM'])process.on(name,()=>{signalSeen=true;controller.abort();});
try{const mode=process.argv[2]??'--inspect';need(process.argv.length<=3&&['--inspect','--execute'].includes(mode),'fixed-owner-caller-arguments');
  if(mode==='--inspect')console.log(JSON.stringify(preparationStatus()));
  else{const result=await runBoundOwner(mode.slice(2),{signal:controller.signal});need(!signalSeen,'owner-caller-canceled');console.log(JSON.stringify(result));}
}catch(error){console.error(JSON.stringify({schema:'riffoid-ir.owner-caller-stopped/v1',code:safeCode(error),automaticRetry:false,credentialsOrRawBodyLogged:false}));process.exitCode=1;}
