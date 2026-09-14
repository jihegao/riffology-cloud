/** Bounded UTF-8, store-only ZIP. No compression, descriptors, ZIP64 or filesystem writes. */
export type ZipEntry={path:string;bytes:Uint8Array};
export const EXPORT_MAX_BYTES=16*1024*1024;
export const EXPORT_MAX_ENTRIES=8192;
const encoder=new TextEncoder();
export function crc32(bytes:Uint8Array){let crc=0xffffffff;for(const byte of bytes){crc^=byte;for(let bit=0;bit<8;bit++)crc=(crc>>>1)^((crc&1)?0xedb88320:0);}return (crc^0xffffffff)>>>0;}
export function exportPath(path:string){if(!path||path.length>512||path.normalize('NFC')!==path||path.startsWith('/')||/[\\\u0000-\u001f\u007f]/u.test(path)||path.split('/').some(part=>!part||part==='.'||part==='..'))throw Error('export-path-invalid');return path;}
export class ExportFiles{
 readonly entries:ZipEntry[]=[];#paths=new Set<string>();#size=22;
 constructor(readonly maxBytes=EXPORT_MAX_BYTES){}
 add(path:string,bytes:Uint8Array){exportPath(path);if(this.#paths.has(path)||!(bytes instanceof Uint8Array))throw Error('export-entry-invalid');const overhead=76+2*encoder.encode(path).byteLength;
  if(this.entries.length>=EXPORT_MAX_ENTRIES||this.#size+overhead+bytes.byteLength>this.maxBytes)throw Error('export-too-large');this.#size+=overhead+bytes.byteLength;this.#paths.add(path);this.entries.push({path,bytes});
 }
 get remaining(){return this.maxBytes-this.#size;}
 finish(){
  const output=new Uint8Array(this.#size),view=new DataView(output.buffer),central:Array<{name:Uint8Array;size:number;crc:number;offset:number}>=[];let offset=0;
  const u16=(at:number,value:number)=>view.setUint16(at,value,true),u32=(at:number,value:number)=>view.setUint32(at,value,true);
  for(const entry of this.entries){const name=encoder.encode(entry.path),size=entry.bytes.byteLength,crc=crc32(entry.bytes),start=offset;
   u32(offset,0x04034b50);u16(offset+4,20);u16(offset+6,0x0800);u16(offset+8,0);u16(offset+10,0);u16(offset+12,33);u32(offset+14,crc);u32(offset+18,size);u32(offset+22,size);u16(offset+26,name.length);u16(offset+28,0);offset+=30;output.set(name,offset);offset+=name.length;output.set(entry.bytes,offset);offset+=size;central.push({name,size,crc,offset:start});
  }
  const start=offset;
  for(const entry of central){u32(offset,0x02014b50);u16(offset+4,20);u16(offset+6,20);u16(offset+8,0x0800);u16(offset+10,0);u16(offset+12,0);u16(offset+14,33);u32(offset+16,entry.crc);u32(offset+20,entry.size);u32(offset+24,entry.size);u16(offset+28,entry.name.length);u16(offset+30,0);u16(offset+32,0);u16(offset+34,0);u16(offset+36,0);u32(offset+38,0);u32(offset+42,entry.offset);offset+=46;output.set(entry.name,offset);offset+=entry.name.length;}
  const centralSize=offset-start;u32(offset,0x06054b50);u16(offset+4,0);u16(offset+6,0);u16(offset+8,central.length);u16(offset+10,central.length);u32(offset+12,centralSize);u32(offset+16,start);u16(offset+20,0);return output;
 }
}
