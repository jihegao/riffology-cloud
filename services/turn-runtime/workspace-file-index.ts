export type WorkspaceFileEntry={path:string;type:'file'|'directory';size:number;mode:number};
export type WorkspaceFileIndex={schemaVersion:1;files:WorkspaceFileEntry[]};
export type WorkspaceFileChange={path:string;change:'added'|'modified'|'deleted';type:'file'|'directory';size:number;mode:number};
export type WorkspaceFileDiff={schemaVersion:1;summary:{added:number;modified:number;deleted:number};changes:WorkspaceFileChange[]};
type ParsedEntry=WorkspaceFileEntry&{contentOffset:number};

const BLOCK=512,RECORD=10240,MAX_ARCHIVE_BYTES=56*1024*1024,MAX_FILE_BYTES=32*1024*1024,MAX_ENTRIES=4096;
const FILE_MODES=new Set([0o600,0o644,0o700,0o755]),DIR_MODES=new Set([0o700,0o755]);
const decoder=new TextDecoder('utf-8',{fatal:true}),encoder=new TextEncoder();
function reject():never{throw Error('invalid-workspace-file-archive');}
function zero(bytes:Uint8Array,start:number,end:number){for(let i=start;i<end;i++)if(bytes[i]!==0)return false;return true;}
function field(bytes:Uint8Array,start:number,length:number):string{
  const value=bytes.slice(start,start+length),found=value.indexOf(0),end=found<0?value.length:found;if(found>=0&&!zero(value,end,value.length))reject();
  try{return decoder.decode(value.slice(0,end));}catch{return reject();}
}
function octal(bytes:Uint8Array,start:number,length:number):number{
  if(bytes[start+length-1]!==0)reject();let raw:string;try{raw=decoder.decode(bytes.slice(start,start+length-1));}catch{return reject();}if(!/^[0-7]+$/.test(raw))reject();const value=Number.parseInt(raw,8);if(!Number.isSafeInteger(value)||value<0)reject();return value;
}
function exact(bytes:Uint8Array,start:number,value:string){const expected=encoder.encode(value);if(expected.length+start>bytes.length)reject();for(let i=0;i<expected.length;i++)if(bytes[start+i]!==expected[i])reject();}
function validPath(value:string):string{
  if(!value||encoder.encode(value).byteLength>512||value.normalize('NFC')!==value||value.startsWith('/')||value.includes('\\'))reject();
  const parts=value.split('/');if(parts.some(part=>!part||part==='.'||part==='..'||part==='.riffology'||[...part].some(char=>{const code=char.codePointAt(0)!;return code<32||code===127;})))reject();
  return value;
}
function before(a:string,b:string){const left=encoder.encode(a),right=encoder.encode(b),length=Math.min(left.length,right.length);for(let i=0;i<length;i++){if(left[i]!==right[i])return left[i]!<right[i]!;}return left.length<right.length;}
function checksum(bytes:Uint8Array,offset:number){let value=0;for(let i=0;i<BLOCK;i++)value+=i>=148&&i<156?32:bytes[offset+i]!;return value;}

/** Indexes only the canonical USTAR format emitted by workspace_archive.py.
 * No file contents or control-plane .riffology entries leave this boundary. */
function parse(raw:Uint8Array):{bytes:Uint8Array;files:ParsedEntry[]}{
  const bytes=Uint8Array.from(raw);if(bytes.byteLength<RECORD||bytes.byteLength>MAX_ARCHIVE_BYTES||bytes.byteLength%RECORD!==0)reject();
  const files:ParsedEntry[]=[],parents=new Set<string>();let offset=0,previous:string|null=null,ended=false;
  while(offset+BLOCK<=bytes.byteLength){
    if(zero(bytes,offset,offset+BLOCK)){const expected=Math.ceil((offset+BLOCK*2)/RECORD)*RECORD;if(bytes.byteLength!==expected||!zero(bytes,offset,bytes.byteLength))reject();ended=true;break;}
    if(files.length>=MAX_ENTRIES)reject();
    exact(bytes,offset+257,'ustar\0');exact(bytes,offset+263,'00');
    if(!zero(bytes,offset+157,offset+257)||!zero(bytes,offset+265,offset+345)||!zero(bytes,offset+500,offset+512))reject();
    const storedChecksum=octal(bytes,offset+148,7);if(bytes[offset+155]!==32||storedChecksum!==checksum(bytes,offset))reject();
    const name=field(bytes,offset,100),prefix=field(bytes,offset+345,155),typeByte=bytes[offset+156],directory=typeByte===53;
    if(typeByte!==48&&typeByte!==53)reject();
    const rawPath=prefix?`${prefix}/${name}`:name;if(directory!==rawPath.endsWith('/'))reject();
    const path=validPath(directory?rawPath.slice(0,-1):rawPath),mode=octal(bytes,offset+100,8),uid=octal(bytes,offset+108,8),gid=octal(bytes,offset+116,8),size=octal(bytes,offset+124,12),mtime=octal(bytes,offset+136,12);
    if(uid!==0||gid!==0||mtime!==0||(!directory&&(!FILE_MODES.has(mode)||size>MAX_FILE_BYTES))||(directory&&(!DIR_MODES.has(mode)||size!==0)))reject();
    if(previous!==null&&!before(previous,path))reject();previous=path;
    const segments=path.split('/');for(let i=1;i<segments.length;i++)if(!parents.has(segments.slice(0,i).join('/')))reject();
    if(directory)parents.add(path);files.push({path,type:directory?'directory':'file',size,mode,contentOffset:offset+BLOCK});
    const padded=Math.ceil(size/BLOCK)*BLOCK,next=offset+BLOCK+padded;if(next>bytes.byteLength||!zero(bytes,offset+BLOCK+size,next))reject();offset=next;
  }
  if(!ended)reject();return {bytes,files};
}
export function workspaceFileIndex(raw:Uint8Array):WorkspaceFileIndex{return {schemaVersion:1,files:parse(raw).files.map(({contentOffset:_,...entry})=>entry)};}
function bytesEqual(a:Uint8Array,aOffset:number,b:Uint8Array,bOffset:number,size:number){for(let i=0;i<size;i++)if(a[aOffset+i]!==b[bOffset+i])return false;return true;}
export function workspaceFileDiff(raw:Uint8Array,rawBase:Uint8Array|null):WorkspaceFileDiff{
  const current=parse(raw),base=rawBase===null?null:parse(rawBase),left=new Map((base?.files??[]).map(entry=>[entry.path,entry])),right=new Map(current.files.map(entry=>[entry.path,entry])),paths=[...new Set([...left.keys(),...right.keys()])].sort((a,b)=>before(a,b)?-1:before(b,a)?1:0),changes:WorkspaceFileChange[]=[];
  let added=0,modified=0,deleted=0;
  for(const path of paths){const old=left.get(path),next=right.get(path);let change:WorkspaceFileChange['change']|null=null,entry:ParsedEntry|undefined;
    if(!old){change='added';entry=next;added++;}else if(!next){change='deleted';entry=old;deleted++;}else if(old.type!==next.type||old.mode!==next.mode||old.size!==next.size||(next.type==='file'&&!bytesEqual(base!.bytes,old.contentOffset,current.bytes,next.contentOffset,next.size))){change='modified';entry=next;modified++;}
    if(change&&entry)changes.push({path,change,type:entry.type,size:entry.size,mode:entry.mode});
  }
  return {schemaVersion:1,summary:{added,modified,deleted},changes};
}

/** Bounded private extraction from the same verified canonical format used by
 * Files/Diff. Authorization belongs to the calling revision authority. */
export function workspaceArchiveReader(raw:Uint8Array){
  const parsed=parse(raw);
  return {
    async sha256(){const hash=await crypto.subtle.digest('SHA-256',parsed.bytes.buffer as ArrayBuffer);return [...new Uint8Array(hash)].map(byte=>byte.toString(16).padStart(2,'0')).join('');},
    read(requests:ReadonlyArray<{path:string;maxBytes:number}>):Map<string,Uint8Array>{
  if(!Array.isArray(requests)||requests.length<1||requests.length>16)throw Error('invalid-workspace-content-request');
  const wanted=new Map<string,number>();let bound=0;
  for(const request of requests){
    if(!request||typeof request.path!=='string'||!Number.isSafeInteger(request.maxBytes)||request.maxBytes<1||wanted.has(request.path))throw Error('invalid-workspace-content-request');
    validPath(request.path);bound+=request.maxBytes;if(bound>2*1024*1024)throw Error('workspace-content-limit');wanted.set(request.path,request.maxBytes);
  }
  const result=new Map<string,Uint8Array>();
  for(const entry of parsed.files){const max=wanted.get(entry.path);if(max===undefined)continue;
    if(entry.type!=='file')throw Error('workspace-content-not-file');if(entry.size>max)throw Error('workspace-content-limit');
    result.set(entry.path,parsed.bytes.slice(entry.contentOffset,entry.contentOffset+entry.size));
  }
  if(result.size!==wanted.size)throw Error('workspace-content-missing');return result;
    },
  };
}
export function workspaceArchiveContents(raw:Uint8Array,requests:ReadonlyArray<{path:string;maxBytes:number}>){return workspaceArchiveReader(raw).read(requests);}
