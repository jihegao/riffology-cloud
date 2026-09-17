import importlib.util
import json
import os
import subprocess
import sys
import unittest
from pathlib import Path
spec = importlib.util.spec_from_file_location('observation', Path(__file__).resolve().parents[2] / 'services/run/simulation_observation.py')
o = importlib.util.module_from_spec(spec); spec.loader.exec_module(o)

class Tests(unittest.TestCase):
    def test_private_preexec_channel_closed_before_model_exec(self):
        r,w=os.pipe()
        def setup():
            os.set_inheritable(w,False)
            payload={'pid':os.getpid(),'uid':[10001]*4,'gid':[10001]*4,'noNewPrivileges':1,'startTicks':1,'rlimitAS':[536870912]*2,'rlimitNPROC':[64]*2,'network':{}}
            os.write(w,json.dumps(payload).encode());os.close(w)
        child=subprocess.Popen([sys.executable,'-c','import os,sys;\ntry: os.fstat(int(sys.argv[1]));sys.exit(9)\nexcept OSError: sys.exit(0)',str(w)],pass_fds=(w,),preexec_fn=setup)
        os.close(w)
        try: self.assertEqual(o.read_child(r,child.pid)['pid'],child.pid)
        finally: os.close(r)
        self.assertEqual(child.wait(timeout=3),0)
    def test_wrong_identity_rejected(self):
        r,w=os.pipe();os.write(w,json.dumps({'pid':1,'uid':[0]*4,'gid':[0]*4,'noNewPrivileges':1,'startTicks':1,'rlimitAS':[536870912]*2,'rlimitNPROC':[64]*2,'network':{}}).encode());os.close(w)
        try:
            with self.assertRaises(RuntimeError):o.read_child(r,1)
        finally:os.close(r)

if __name__=='__main__':unittest.main()
