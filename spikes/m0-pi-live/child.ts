/** Entry source is shipped with the trusted release; HTTP callers cannot
 * provide code, file paths, prompts or process arguments. */
export const MODULE_DIR = '/opt/riffology/services/runtime';
export const INPUT = '/opt/m0-go-input.json';
export const OUTPUT = '/opt/m0-go-result.json';
export const ENTRY = `${MODULE_DIR}/go-live-entry.mjs`;
export const childSource = `import {runGoPiProbe} from './go-pi-probe.mjs';
import {readFile,lstat,chmod,mkdir,writeFile,rename,unlink} from 'node:fs/promises';
const timer=setTimeout(()=>process.exit(124),40000);
try{
 const info=await lstat('${INPUT}');if(!info.isFile()||info.isSymbolicLink()||info.size>65536)throw Error('input');
 await chmod('${INPUT}',0o600);const input=JSON.parse(await readFile('${INPUT}','utf8'));await unlink('${INPUT}');
 await mkdir(input.trustedCwd,{recursive:false,mode:0o700});
 const result=await runGoPiProbe(input);const text=JSON.stringify(result);
 if(Buffer.byteLength(text)>65536)throw Error('output');
 await writeFile('${OUTPUT}.tmp',text,{mode:0o600,flag:'wx'});await rename('${OUTPUT}.tmp','${OUTPUT}');
 process.stdout.write('go-probe-finished\\n');
}catch{process.stderr.write('go-probe-failed\\n');process.exitCode=1;}finally{clearTimeout(timer);}`;
export const EGRESS_OUTPUT = '/opt/m0-egress-result.json';
export function egressEntry(role:'trusted'|'project') { return `import {runEgressProbe} from './egress-probe.mjs';
import {mkdir,writeFile,rename} from 'node:fs/promises';
const timer=setTimeout(()=>process.exit(124),40000);
try{await mkdir('/opt/m0-egress',{mode:0o700});
const result=await runEgressProbe({role:'${role}',outputDirectory:'/opt/m0-egress'});
const text=JSON.stringify(result);if(Buffer.byteLength(text)>65536)throw Error('output');
await writeFile('${EGRESS_OUTPUT}.tmp',text,{mode:0o600,flag:'wx'});await rename('${EGRESS_OUTPUT}.tmp','${EGRESS_OUTPUT}');
process.stdout.write('egress-probe-finished\\n');
}catch{process.stderr.write('egress-probe-failed\\n');process.exitCode=1;}finally{clearTimeout(timer);}`; }
