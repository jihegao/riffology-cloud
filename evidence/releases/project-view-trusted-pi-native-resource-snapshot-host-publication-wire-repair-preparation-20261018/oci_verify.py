"""Pure bounded OCI archive verifier; no extraction, subprocess, auth or network."""
import gzip,hashlib,json,re,tarfile
HEX=re.compile(r'^[a-f0-9]{64}$')
INDEX='application/vnd.oci.image.index.v1+json';MANIFEST='application/vnd.oci.image.manifest.v1+json'
class Stop(Exception):pass
def guard(ok,code):
 if not ok:raise Stop(code)
def digest(b):return 'sha256:'+hashlib.sha256(b).hexdigest()
def descriptor(x):
 guard(isinstance(x,dict) and isinstance(x.get('digest'),str) and x['digest'].startswith('sha256:')
  and HEX.fullmatch(x['digest'][7:]) and type(x.get('size')) is int and 0<x['size']<=4294967296
  and isinstance(x.get('mediaType'),str),'oci-descriptor-shape')
 return {k:x[k] for k in ('digest','size','mediaType')}
def verify(path,scope,expected_diff_ids):
 guard(path.is_file() and not path.is_symlink() and path.resolve()==path
  and 0<path.stat().st_size<=scope['archiveMaximumBytes'],'bounded-original-archive')
 archive_sha=hashlib.sha256();size=0
 with path.open('rb') as f:
  while True:
   b=f.read(1048576)
   if not b:break
   size+=len(b);guard(size<=scope['archiveMaximumBytes'],'archive-byte-limit');archive_sha.update(b)
 with tarfile.open(path,mode='r:') as tar:
  members={};blobs={};total=0
  for m in tar:
   n=m.name.rstrip('/')
   guard(n and not n.startswith('/') and all(p not in ('','.','..') for p in n.split('/'))
    and n not in members and (m.isdir() or m.isreg()) and not m.linkname,'safe-unique-regular-or-directory-member')
   guard(n in ('blobs','blobs/sha256','index.json','manifest.json','oci-layout')
    or n.startswith('blobs/sha256/') and HEX.fullmatch(n.split('/')[-1]) and len(n.split('/'))==3,'fixed-oci-member-path')
   members[n]=m;guard(len(members)<=256 and 0<=m.size<=scope['archiveMaximumBytes'],'archive-member-bound')
   if m.isfile() and n.startswith('blobs/sha256/'):
    h=hashlib.sha256();count=0
    with tar.extractfile(m) as f:
     while True:
      b=f.read(1048576)
      if not b:break
      count+=len(b);h.update(b)
    guard(count==m.size and h.hexdigest()==n.split('/')[-1],'every-raw-blob-sha-size')
    blobs['sha256:'+h.hexdigest()]={'member':m,'size':count};total+=count
  def small(name,limit=1048576):
   guard(name in members and members[name].isreg() and members[name].size<=limit,'bounded-oci-metadata')
   f=tar.extractfile(members[name]);b=f.read(limit+1);f.close();guard(len(b)==members[name].size,'complete-oci-metadata');return b
  guard(json.loads(small('oci-layout'))=={'imageLayoutVersion':'1.0.0'},'oci-layout-version')
  wrapper=json.loads(small('index.json'));guard(wrapper.get('schemaVersion')==2 and len(wrapper.get('manifests',[]))==1,'unique-archive-wrapper-target')
  root=descriptor(wrapper['manifests'][0]);guard(root==scope['sourceDescriptor'],'approved-local-index-target')
  reached=set();documents={}
  def visit(desc,depth=0):
   core=descriptor(desc);d=core['digest'];guard(depth<=4 and d in blobs and blobs[d]['size']==core['size'],'reachable-descriptor-size')
   if d in reached:return
   reached.add(d)
   if core['mediaType'] in (INDEX,MANIFEST):
    doc=json.loads(small('blobs/sha256/'+d[7:]));guard(doc.get('schemaVersion')==2,'oci-document-schema2');documents[d]=doc
    children=doc.get('manifests') if core['mediaType']==INDEX else [doc.get('config')]+doc.get('layers',[])
    guard(isinstance(children,list) and 0<len(children)<=128,'bounded-oci-descriptor-children')
    for child in children:visit(child,depth+1)
  visit(root);guard(reached==set(blobs),'all-archive-blobs-reachable-from-original-index')
  original=documents[root['digest']];candidates=[x for x in original.get('manifests',[]) if x.get('platform',{}).get('os')=='linux' and x.get('platform',{}).get('architecture')=='amd64']
  guard(len(candidates)==1 and candidates[0].get('mediaType')==MANIFEST,'unique-original-linux-amd64-manifest')
  runnable=descriptor(candidates[0]);manifest=documents[runnable['digest']];config_desc=descriptor(manifest.get('config'))
  config=json.loads(small('blobs/sha256/'+config_desc['digest'][7:]));layers=manifest.get('layers');diffids=config.get('rootfs',{}).get('diff_ids')
  guard(config.get('os')=='linux' and config.get('architecture')=='amd64' and isinstance(layers,list)
   and diffids==expected_diff_ids and len(layers)==len(diffids)>0,'actual-config-platform-rootfs-binding')
  total_unpacked=0
  for layer,expected in zip(layers,diffids):
   d=descriptor(layer);f=tar.extractfile(blobs[d['digest']]['member'])
   if d['mediaType']=='application/vnd.oci.image.layer.v1.tar+gzip':stream=gzip.GzipFile(fileobj=f)
   elif d['mediaType']=='application/vnd.oci.image.layer.v1.tar':stream=f
   else:raise Stop('unsupported-layer-format-no-conversion')
   h=hashlib.sha256()
   try:
    while True:
     b=stream.read(1048576)
     if not b:break
     total_unpacked+=len(b);guard(total_unpacked<=scope['decompressedLayerMaximumTotalBytes'],'decompressed-layer-total-bound');h.update(b)
   finally:stream.close();f.close()
   guard('sha256:'+h.hexdigest()==expected,'all-layer-diffids-match-original-image')
  result={'schema':'trusted-pi-original-oci-verification/v1','sourceImageId':scope['sourceImageId'],'archiveBytes':size,
   'archiveSha256':archive_sha.hexdigest(),'originalIndex':root,'linuxAmd64Manifest':runnable,'config':config_desc,
   'layers':[descriptor(x) for x in layers],'blobCount':len(blobs),'allRawBlobHashesSizesReachable':True,
   'allRunnableDiffIdsMatched':True,'rootfsLayerCount':len(diffids),'publisherSignatureVerified':False,
   'registryPublicationClaim':False,'unpackedBytesObserved':total_unpacked}
  raw={'index':small('blobs/sha256/'+root['digest'][7:]),'manifest':small('blobs/sha256/'+runnable['digest'][7:]),'config':small('blobs/sha256/'+config_desc['digest'][7:])}
  return result,raw
