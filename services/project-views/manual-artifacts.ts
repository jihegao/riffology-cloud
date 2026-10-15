import {manualDigest,type ManualArtifactDeclaration,type ManualRevisionReceipt} from '../turn-runtime/manual-save.ts';
import {workspaceArchiveReader,workspaceFileIndex} from '../turn-runtime/workspace-file-index.ts';
export async function manualArtifactReceipts(revision:ManualRevisionReceipt,archive:Uint8Array,declarations:ManualArtifactDeclaration[]){
 const index=workspaceFileIndex(archive),reader=workspaceArchiveReader(archive);
 return Promise.all(declarations.map(async item=>{
  const file=index.files.find(f=>f.path===item.path&&f.type==='file');if(!file||file.size>256*1024)throw Error('manual-artifact-invalid');
  const bytes=reader.read([{path:item.path,maxBytes:256*1024}]).get(item.path)!,sha256=await manualDigest(bytes);
  const mediaType=item.path.endsWith('.json')?'application/json':/\.(txt|md|csv|html|css|js|mjs)$/.test(item.path)?'text/plain':'application/octet-stream';
  return {source:'user-upload' as const,artifactId:'manual-artifact-'+await manualDigest(JSON.stringify({revisionId:revision.revisionId,path:item.path,sha256})),revisionId:revision.revisionId,path:item.path,sha256,bytes:bytes.length,mediaType,title:item.title};
 }));
}
