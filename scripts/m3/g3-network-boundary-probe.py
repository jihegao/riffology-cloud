import socket,subprocess,os,json,sys
listener=socket.socket();listener.bind(('127.0.0.1',0));listener.listen(1);listener.settimeout(3)
port=listener.getsockname()[1]
path='/tmp/g3-root-controlled.sock'
try:os.unlink(path)
except FileNotFoundError:pass
unix=socket.socket(socket.AF_UNIX);unix.bind(path);os.chmod(path,0o777);unix.listen(1);unix.settimeout(3)
def child_setup():os.setgroups([]);os.setgid(10001);os.setuid(10001)
code='''import socket,json,os,sys,ctypes,pathlib,resource
results={"uid":os.geteuid(),"gid":os.getegid(),"groups":os.getgroups(),"status":pathlib.Path('/proc/self/status').read_text(),"addressSpaceLimit":resource.getrlimit(resource.RLIMIT_AS)}
for name,address in [("loopback",("127.0.0.1",int(sys.argv[1]))),("unix",sys.argv[2])]:
 s=socket.socket(socket.AF_UNIX if name=="unix" else socket.AF_INET);s.settimeout(2)
 try:s.connect(address);s.sendall(b"project-arrival");results[name]={"connected":True}
 except OSError as error:results[name]={"connected":False,"errno":error.errno,"error":str(error)}
 finally:s.close()
for name,kind in [("external-tcp",socket.SOCK_STREAM),("external-udp",socket.SOCK_DGRAM)]:
 s=socket.socket(socket.AF_INET,kind);s.settimeout(2)
 try:s.connect(("198.51.100.1",443));results[name]={"connected":True}
 except OSError as error:results[name]={"connected":False,"errno":error.errno}
 finally:s.close()
s=socket.socket(socket.AF_INET,socket.SOCK_DGRAM)
try:s.sendto(b"probe",("203.0.113.1",9999));results["udp-sendto"]={"sent":True}
except OSError as error:results["udp-sendto"]={"sent":False,"errno":error.errno}
finally:s.close()
libc=ctypes.CDLL(None,use_errno=True)
for number in (425,426,427):
 ctypes.set_errno(0);value=libc.syscall(number,0,0,0,0,0,0);results["guest-syscall-"+str(number)]={"value":value,"errno":ctypes.get_errno()}
print(json.dumps(results))'''
prefix=[sys.argv[1]] if len(sys.argv)>1 else []
p=subprocess.run(prefix+['/opt/riffology/python-mesa/bin/python3','-c',code,str(port),path],preexec_fn=child_setup,capture_output=True,text=True,timeout=8)
arrivals={}
for name,s in [('loopback',listener),('unix',unix)]:
 try:c,_=s.accept();arrivals[name]=c.recv(100).decode();c.close()
 except TimeoutError:arrivals[name]=None
 s.close()
print(json.dumps({'child':json.loads(p.stdout) if p.stdout.strip() else None,'childExitCode':p.returncode,'childStderr':p.stderr,'nativeHelper':bool(prefix) or 'arm64-kernel uid10001' in p.stderr,'arrivals':arrivals,'scope':'actual SDK container test-only native ARM64 kernel bridge' if prefix or 'arm64-kernel uid10001' in p.stderr else 'actual SDK container Workerd egress only; no project native fence'}))
os.unlink(path)
