import socket,subprocess,os,json,tempfile
listener=socket.socket();listener.bind(('127.0.0.1',0));listener.listen(1);listener.settimeout(3)
port=listener.getsockname()[1]
path='/tmp/g3-root-controlled.sock'
try:os.unlink(path)
except FileNotFoundError:pass
unix=socket.socket(socket.AF_UNIX);unix.bind(path);os.chmod(path,0o777);unix.listen(1);unix.settimeout(3)
def child_setup():os.setgroups([]);os.setgid(10001);os.setuid(10001)
code='''import socket,json,os,sys
results={"uid":os.geteuid()}
for name,address in [("loopback",("127.0.0.1",int(sys.argv[1]))),("unix",sys.argv[2])]:
 s=socket.socket(socket.AF_UNIX if name=="unix" else socket.AF_INET);s.settimeout(2)
 try:s.connect(address);s.sendall(b"project-arrival");results[name]={"connected":True}
 except OSError as error:results[name]={"connected":False,"errno":error.errno,"error":str(error)}
 finally:s.close()
print(json.dumps(results))'''
p=subprocess.run(['/opt/riffology/python-mesa/bin/python3','-c',code,str(port),path],preexec_fn=child_setup,capture_output=True,text=True,timeout=8)
arrivals={}
for name,s in [('loopback',listener),('unix',unix)]:
 try:c,_=s.accept();arrivals[name]=c.recv(100).decode();c.close()
 except TimeoutError:arrivals[name]=None
 s.close()
print(json.dumps({'child':json.loads(p.stdout),'arrivals':arrivals,'scope':'actual SDK container Workerd egress only; no project native fence'}))
os.unlink(path)
