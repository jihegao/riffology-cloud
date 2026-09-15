"""Build a freestanding Linux ARM64 ELF using the existing clang assembler.
No libc/download/linker is required. Reject relocations before emitting ELF.
"""
import hashlib,json,pathlib,struct,subprocess
root=pathlib.Path.cwd();out=root/'.local/g3-native-helper';out.mkdir(parents=True,exist_ok=True)
source=root/'scripts/m3/fixtures/g3-arm64-project-fence.S';obj=out/'project-fence.o'
subprocess.run(['clang','-target','aarch64-linux-gnu','-c',str(source),'-o',str(obj)],check=True)
p=obj.read_bytes();e=struct.unpack_from('<16sHHIQQQIHHHHHH',p)
assert e[2]==183 and e[0][:7]==b'\x7fELF\x02\x01\x01'
sections=[struct.unpack_from('<IIQQQQIIQQ',p,e[6]+i*e[11]) for i in range(e[12])]
s=sections[e[13]];strings=p[s[4]:s[4]+s[5]];text=None
for section in sections:
 name=strings[section[0]:].split(b'\0')[0]
 if section[1] in (4,9) and section[5]:raise ValueError('unexpected ELF relocation '+str(name))
 if name==b'.text':text=p[section[4]:section[4]+section[5]]
assert text and len(text)<4096
header=struct.pack('<16sHHIQQQIHHHHHH',b'\x7fELF\x02\x01\x01'+b'\0'*9,2,183,1,0x401000,64,0,0,64,56,1,0,0,0)
program=struct.pack('<IIQQQQQQ',1,5,0,0x400000,0x400000,4096+len(text),4096+len(text),4096)
binary=header+program+b'\0'*(4096-120)+text;(out/'project-fence').write_bytes(binary)
facts={'sourceSha256':hashlib.sha256(source.read_bytes()).hexdigest(),'binarySha256':hashlib.sha256(binary).hexdigest(),'byteLength':len(binary),'assembler':subprocess.check_output(['clang','--version'],text=True),'target':'Linux ARM64 static freestanding ELF','relocations':0}
(out/'build.json').write_text(json.dumps(facts,indent=2));print(json.dumps(facts))

import sys,shutil
if '--image' in sys.argv:
 context=out/'image';context.mkdir(exist_ok=True)
 shutil.copy2(out/'project-fence',context/'project-fence')
 for src,dst in [('g3-python-kernel-bridge.sh','g3-python-kernel-bridge.sh'),('Dockerfile.g3-native-bridge','Dockerfile')]:shutil.copy2(root/'scripts/m3/fixtures'/src,context/dst)
 image='riffology-g3-native-bridge:local';base='riffology-g1-mesa:local'
 baseFacts=json.loads(subprocess.check_output(['docker','image','inspect',base],text=True))[0]
 subprocess.run(['docker','build','--platform','linux/amd64','-t',image,str(context)],check=True)
 imageFacts=json.loads(subprocess.check_output(['docker','image','inspect',image],text=True))[0]
 receipt={'baseImage':base,'baseImageIdentity':baseFacts['Id'],'testImage':image,'testImageIdentity':imageFacts['Id'],'helper':facts,'wrapperSha256':hashlib.sha256((context/'g3-python-kernel-bridge.sh').read_bytes()).hexdigest(),'dockerfileSha256':hashlib.sha256((context/'Dockerfile').read_bytes()).hexdigest(),'scope':'test-only ARM64 host-kernel bridge; unchanged production files'}
 (out/'image.json').write_text(json.dumps(receipt,indent=2));print(json.dumps(receipt))
