const encoder=new TextEncoder();
const BLOCK=512,RECORD=10240,MAX_ENTRIES=4096,MAX_CONTENT_BYTES=8*1024*1024+64*1024;
const DIRECTORIES=['model','app','experiments','results','docs'];
type Entry={path:string;content:Uint8Array|null};
function reject():never{throw Error('invalid-initial-workspace-archive');}
function path(value:string):void{
  if(!value||!value.isWellFormed()||value.normalize('NFC')!==value||encoder.encode(value).length>512||value.includes('\\')||/[\u0000-\u001f\u007f]/u.test(value)||value.split('/').some(part=>!part||part==='.'||part==='..'||part==='.riffology'))reject();
}
function split(value:string):{name:string;prefix:string}{
  if(encoder.encode(value).length<=100)return {name:value,prefix:''};
  for(let i=0;i<value.length;i++)if(value[i]==='/'){
    const prefix=value.slice(0,i),name=value.slice(i+1);
    if(encoder.encode(prefix).length<=155&&encoder.encode(name).length<=100)return {name,prefix};
  }
  return reject();
}
function compare(a:Entry,b:Entry){const left=encoder.encode(a.path),right=encoder.encode(b.path);for(let i=0;i<Math.min(left.length,right.length);i++)if(left[i]!==right[i])return left[i]!-right[i]!;return left.length-right.length;}
function header(entry:Entry):Uint8Array{
  const result=new Uint8Array(BLOCK),directory=entry.content===null,{name,prefix}=split(entry.path+(directory?'/':''));
  const field=(offset:number,value:string)=>result.set(encoder.encode(value),offset);
  const octal=(offset:number,width:number,value:number)=>field(offset,value.toString(8).padStart(width-1,'0')+'\0');
  field(0,name);octal(100,8,directory?0o755:0o644);octal(108,8,0);octal(116,8,0);octal(124,12,entry.content?.length??0);octal(136,12,0);
  result.fill(32,148,156);field(156,directory?'5':'0');field(257,'ustar\0'+'00');field(345,prefix);
  const checksum=result.reduce((sum,value)=>sum+value,0);field(148,checksum.toString(8).padStart(6,'0')+'\0 ');return result;
}

/** Emits exactly the regular-file/directory USTAR representation used by the
 * Project helper. No platform control files, executable bits or links enter it. */
function collectEntries(files:Readonly<Record<string,Uint8Array>>,copy:boolean):Entry[]{
  if(!files||typeof files!=='object'||Array.isArray(files)||(Object.getPrototypeOf(files)!==Object.prototype&&Object.getPrototypeOf(files)!==null)||Reflect.ownKeys(files).some(key=>typeof key!=='string'))reject();
  const entries=new Map<string,Entry>(DIRECTORIES.map(path=>[path,{path,content:null}]));let total=0;
  for(const [name,descriptor] of Object.entries(Object.getOwnPropertyDescriptors(files))){
    path(name);const value=descriptor.value;if(!descriptor.enumerable||!('value' in descriptor)||!(value instanceof Uint8Array))reject();
    total+=value.length;if(total>MAX_CONTENT_BYTES||entries.has(name))reject();
    entries.set(name,{path:name,content:copy?Uint8Array.from(value):value});
  }
  for(const name of [...entries.keys()]){
    const parts=name.split('/');for(let i=1;i<parts.length;i++){
      const parent=parts.slice(0,i).join('/'),existing=entries.get(parent);
      if(existing&&existing.content!==null)reject();if(!existing)entries.set(parent,{path:parent,content:null});
    }
  }
  if(entries.size>MAX_ENTRIES)reject();
  const sorted=[...entries.values()].sort(compare);
  for(const entry of sorted)split(entry.path+(entry.content===null?'/':''));
  return sorted;
}

/** Validates the same limits as encoding without copying file bytes or allocating a tar. */
export function validateInitialWorkspaceArchive(files:Readonly<Record<string,Uint8Array>>):void{
  collectEntries(files,false);
}

export function initialWorkspaceArchive(files:Readonly<Record<string,Uint8Array>>):Uint8Array{
  const sorted=collectEntries(files,true),headers=sorted.map(header);
  const length=sorted.reduce((sum,entry)=>sum+BLOCK+Math.ceil((entry.content?.length??0)/BLOCK)*BLOCK,0);
  const result=new Uint8Array(Math.ceil((length+2*BLOCK)/RECORD)*RECORD);let offset=0;
  for(let i=0;i<sorted.length;i++){result.set(headers[i]!,offset);offset+=BLOCK;const content=sorted[i]!.content;if(content){result.set(content,offset);offset+=Math.ceil(content.length/BLOCK)*BLOCK;}}
  return result;
}
