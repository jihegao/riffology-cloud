import { canonicalWorkspaceMarker, WORKSPACE_LAYOUT, workspaceDigest, type RuntimeInitialize } from '../workspace/protocol.ts';
import type { ModelContentReceipt } from './content.ts';

export const WORKSPACE_DIRECTORIES = ['model', 'app', 'experiments', 'results', 'docs', '.riffology'] as const;
export const MARKER_PATH = '/workspace/.riffology/initialization.json';
export function initialFiles(input: RuntimeInitialize): Record<string, string> {
  return { '.riffology/initialization.json': canonicalWorkspaceMarker(input.identity, input.markerNonce),
    'README.md': '# Workspace\n\nProject files belong here. The platform manages identity, persistence and execution.\n' };
}
export async function initialCheckpoint(input: RuntimeInitialize, modelContent?:ModelContentReceipt) {
  const text = JSON.stringify({ schemaVersion: 1, layoutVersion: WORKSPACE_LAYOUT,
    directories: WORKSPACE_DIRECTORIES, files: initialFiles(input), ...(modelContent?{modelContent:structuredClone(modelContent)}:{}) });
  return { text, revision: await workspaceDigest(text) };
}
/** Fixed platform program: inputs are serialized data, never shell fragments.
 * Writes each file once and fsyncs before the marker can be observed. */
export function initializationProgram(input: RuntimeInitialize): string {
  return `const fs=require('node:fs');const path=require('node:path');
const dirs=${JSON.stringify(WORKSPACE_DIRECTORIES)},files=${JSON.stringify(initialFiles(input))};
fs.mkdirSync('/workspace',{recursive:true});
for(const d of dirs)fs.mkdirSync(path.join('/workspace',d),{recursive:true});
for(const [name,content] of Object.entries(files).reverse()){
 const fd=fs.openSync(path.join('/workspace',name),'wx',0o600);
 try{fs.writeFileSync(fd,content);fs.fsyncSync(fd);}finally{fs.closeSync(fd);}
}
setInterval(()=>{},1000);`;
}
/** Fixed installer. The first stdin line is the verified manifest; the
 * remaining bytes are the files concatenated in manifest order. Keeping all
 * package-dependent data on stdin avoids argv/env limits and log exposure. */
export const INSTALL_MODEL_CONTENT=`const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const chunks=[];let received=0;process.stdin.on('data',c=>{received+=c.length;if(received>16*1024*1024)process.exit(20);chunks.push(c)});process.stdin.on('end',()=>{try{
 const input=Buffer.concat(chunks),newline=input.indexOf(10);if(newline<1)process.exit(21);
 const model=JSON.parse(input.subarray(0,newline).toString('utf8')),roots=new Set(['model','app','experiments','docs']);
 if(!model||model.schemaVersion!==1||!Array.isArray(model.files)||model.files.length<1||model.files.length>4096)process.exit(22);
 let offset=newline+1,total=0,previous=null;
 for(const f of model.files){if(!f||typeof f.path!=='string'||f.path.normalize('NFC')!==f.path||f.path.length<1||f.path.length>512||/[\\u0000-\\u001f\\u007f]/u.test(f.path)||f.path.startsWith('/')||f.path.includes('\\\\'))process.exit(23);
  const parts=f.path.split('/');if(parts.some(p=>!p||p==='.'||p==='..')||!roots.has(parts[0])||(previous!==null&&f.path<=previous)||!Number.isSafeInteger(f.bytes)||f.bytes<0||f.bytes>1024*1024||typeof f.sha256!=='string'||!/^[a-f0-9]{64}$/.test(f.sha256))process.exit(24);
  previous=f.path;total+=f.bytes;if(total>8*1024*1024||offset+f.bytes>input.length)process.exit(25);
  const bytes=input.subarray(offset,offset+f.bytes);offset+=f.bytes;if(crypto.createHash('sha256').update(bytes).digest('hex')!==f.sha256)process.exit(26);
  const target=path.join('/workspace',f.path),parent=path.dirname(target);fs.mkdirSync(parent,{recursive:true});let current='/workspace';for(const part of parts.slice(0,-1)){current=path.join(current,part);const stat=fs.lstatSync(current);if(!stat.isDirectory()||stat.isSymbolicLink())process.exit(27)}
  if(fs.existsSync(target)){const stat=fs.lstatSync(target);if(!stat.isFile()||stat.isSymbolicLink()||stat.nlink!==1||stat.size!==f.bytes||crypto.createHash('sha256').update(fs.readFileSync(target)).digest('hex')!==f.sha256)process.exit(28);continue}
  const temporary=target+'.riffology-install-'+process.pid;const fd=fs.openSync(temporary,'wx',0o600);try{const stat=fs.fstatSync(fd);if(!stat.isFile()||stat.nlink!==1)process.exit(28);fs.writeFileSync(fd,bytes);fs.fsyncSync(fd)}finally{fs.closeSync(fd)}fs.renameSync(temporary,target);
 }
 if(offset!==input.length)process.exit(29);
}catch(error){process.exit(30)}});`;

/** Fixed observer. The verified manifest arrives on stdin rather than argv. */
export const INSPECT_INITIAL_FILES=`const fs=require('node:fs');const crypto=require('node:crypto');const dirs=${JSON.stringify(WORKSPACE_DIRECTORIES)};const chunks=[];let received=0;process.stdin.on('data',c=>{received+=c.length;if(received>4*1024*1024)process.exit(2);chunks.push(c)});process.stdin.on('end',()=>{const model=JSON.parse(Buffer.concat(chunks).toString('utf8'));
for(const d of dirs)if(!fs.lstatSync('/workspace/'+d).isDirectory())process.exit(3);
const result={};for(const n of ['.riffology/initialization.json','README.md']){
 const p='/workspace/'+n,s=fs.lstatSync(p);if(!s.isFile()||s.size>8192)process.exit(4);
 result[n]=fs.readFileSync(p,'utf8');
}if(model){for(const f of model.files){const p='/workspace/'+f.path,s=fs.lstatSync(p);if(!s.isFile()||s.size!==f.bytes)process.exit(5);const h=crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');if(h!==f.sha256)process.exit(6);}}process.stdout.write(JSON.stringify(result));});`;
