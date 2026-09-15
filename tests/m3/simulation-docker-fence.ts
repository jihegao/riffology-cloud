import {resolve} from 'node:path';
/** Test-only native kernel boundary for amd64 translation. No production image change. */
export function dockerFenceOptions(){
 if(process.env.G1_DOCKER_OUTER_NETWORK_FENCE!=='1')return [];
 return ['--security-opt','no-new-privileges','--security-opt',`seccomp=${resolve('tests/m3/fixtures/docker-deny-network.json')}`,'-e','RIFFOLOGY_SERVICE_PLATFORM_EGRESS_FENCE=workerd-deny-all-v1'];
}
export const DOCKER_FENCE_PROBE=String.raw`import ctypes,errno,json,socket
results={}
for name,family,kind in [('ipv4_tcp',socket.AF_INET,socket.SOCK_STREAM),('ipv4_udp',socket.AF_INET,socket.SOCK_DGRAM),('ipv6',socket.AF_INET6,socket.SOCK_STREAM),('unix',socket.AF_UNIX,socket.SOCK_STREAM)]:
 try: socket.socket(family,kind);raise RuntimeError('socket permitted: '+name)
 except PermissionError as error: results[name]=error.errno
try: socket.socketpair();raise RuntimeError('socketpair permitted')
except PermissionError as error: results['socketpair']=error.errno
libc=ctypes.CDLL(None,use_errno=True)
# Valid pointers are necessary: translated libc may reject a null pointer
# before making any host-kernel syscall, which is not a seccomp observation.
address=ctypes.create_string_buffer(bytes([2,0,31,144,127,0,0,1])+bytes(8))
for name,args in [('connect',(-1,ctypes.byref(address),16)),('bind',(-1,ctypes.byref(address),16)),('listen',(-1,1)),('shutdown',(-1,0))]:
 function=getattr(libc,name)
 if name in ('connect','bind'): function.argtypes=[ctypes.c_int,ctypes.c_void_p,ctypes.c_uint]
 ctypes.set_errno(0);value=function(*args);error=ctypes.get_errno()
 if value!=-1 or error!=errno.EPERM: raise RuntimeError('syscall not denied: '+name+':'+str(error))
 results[name]=error
status=dict(line.split(':',1) for line in open('/proc/self/status') if line.startswith(('NoNewPrivs:','Seccomp:')))
if status['NoNewPrivs'].strip()!='1' or status['Seccomp'].strip()!='2': raise RuntimeError('boundary absent')
print(json.dumps({'denied':results,'noNewPrivileges':True,'seccomp':2},sort_keys=True))`;
