export type CommandProof={command:string;cwd:string;exitCode:number|null};
/** Deliberately bounded shell grammar: words, literal quotes, and && lists.
 * Substitution, redirection, pipelines, OR lists, background jobs and compound
 * control flow need a real shell trace and are reported as unverifiable. */
function tokenize(command:string):string[][]|null{
 if(typeof command!=='string'||command.length>32768)return null;
 const segments:string[][]=[[]];let word='',active=false,quote:''|'single'|'double'='';
 const flush=()=>{if(active){segments.at(-1)!.push(word);word='';active=false;}};
 for(let i=0;i<command.length;i++){
  const c=command[i];
  if(quote==='single'){if(c==="'")quote='';else word+=c;continue;}
  if(c==='$'||c==='`')return null;
  if(quote==='double'){if(c==='"')quote='';else if(c==='\\'){const next=command[++i];if(next===undefined||!['"','\\'].includes(next))return null;word+=next;}else word+=c;continue;}
  if(c==="'"||c==='"'){quote=c==="'"?'single':'double';active=true;continue;}
  if(/\s/.test(c)){if(c==='\n'||c==='\r')return null;flush();continue;}
  if(c==='&'&&command[i+1]==='&'){flush();if(!segments.at(-1)!.length)return null;segments.push([]);i++;continue;}
  if(/[;&|<>()\\*?\[\]{}~#]/.test(c))return null;
  word+=c;active=true;
 }
 if(quote)return null;flush();return segments.at(-1)!.length?segments:null;
}
function cwdPath(raw:string):string|null{return raw.startsWith('/')&&!/[\\\u0000-\u001f]/.test(raw)&&!raw.split('/').some(p=>p==='..'||p==='.')?raw.replace(/\/+$/,'')||'/':null;}
export function verifyCommandEvidence(proof:CommandProof,expected:{argv:string[];cwd:string}):{status:'matched'|'unverifiable'|'not-observed';category:'harness';reason:string}{
 const result=(status:'matched'|'unverifiable'|'not-observed',reason:string)=>({status,category:'harness' as const,reason});
 if(proof.exitCode!==0)return result('not-observed','command-success-not-proven');
 let segments=tokenize(proof.command),cwd=cwdPath(proof.cwd);const expectedCwd=cwdPath(expected.cwd);
 if(!segments||!cwd||!expectedCwd||!Array.isArray(expected.argv)||!expected.argv.length)return result('unverifiable','unsupported-command-grammar');
 if(segments.length===1&&['bash','/bin/bash','sh','/bin/sh'].includes(segments[0][0])&&segments[0][1]==='-lc'&&segments[0].length===3){segments=tokenize(segments[0][2]);if(!segments)return result('unverifiable','unsupported-command-grammar');}
 if(segments.some(argv=>argv[0]!=='cd'&&!['python','python3','/usr/bin/python3'].includes(argv[0])))return result('unverifiable','unsupported-executable');
 for(const argv of segments){
  if(argv[0]==='cd'){if(argv.length!==2)return result('unverifiable','unsupported-cwd');cwd=cwdPath(argv[1].startsWith('/')?argv[1]:`${cwd}/${argv[1]}`);if(!cwd)return result('unverifiable','unsupported-cwd');continue;}
  if(cwd===expectedCwd&&argv.length===expected.argv.length&&argv.every((v,i)=>v===expected.argv[i]))return result('matched','exact-argv-and-cwd');
 }
 return result('not-observed','declared-command-not-observed');
}
