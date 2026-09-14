#!/usr/bin/env python3
"""Bounded independent validation for the priority runner; standard library only."""
import csv, itertools, json, os, shutil, subprocess, tempfile

ROOT=os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SEEDS=(99,20260914); SERVERS=(1,2,4); FRACTIONS=(0,.3,1)

def run(directory, params, seed, suffix=''):
    os.makedirs(directory, exist_ok=True)
    inp=os.path.join(directory,'input'+suffix+'.json'); out=os.path.join(directory,'result'+suffix+'.json')
    with open(inp,'w') as f: json.dump({'schemaVersion':1,'runId':'validation','parameters':params,'seed':seed},f)
    subprocess.run(['python3',os.path.join(ROOT,'model','run.py'),'--input',inp,'--output',out],check=True,timeout=2)
    return out,os.path.join(directory,'customers.csv')

def check(csv_path, params):
    rows=list(csv.DictReader(open(csv_path, newline=''))); n=len(rows); assert n==params['customers']
    for r in rows:
        assert float(r['start']) >= float(r['arrival'])-1e-9
        assert abs(float(r['wait'])-(float(r['start'])-float(r['arrival'])))<2e-8
        assert float(r['completion']) >= float(r['start'])
    # Every chosen customer must be no worse than every earlier-arrived customer
    # still waiting at that start (service already in progress is excluded).
    for r in rows:
        start=float(r['start']); key=(0 if r['priority']=='high' else 1,float(r['arrival']),int(r['customer']))
        for other in rows:
            if float(other['arrival']) <= start+1e-9 and float(other['start']) > start+1e-8:
                okey=(0 if other['priority']=='high' else 1,float(other['arrival']),int(other['customer']))
                assert key <= okey, (r,other)
    # At any time, active intervals cannot exceed server count.
    events=[]
    for r in rows: events += [(float(r['start']),1),(float(r['completion']),-1)]
    active=0
    for _,delta in sorted(events,key=lambda x:(x[0],x[1])):
        active+=delta; assert active<=params['servers'] and active>=0

def main():
    root=tempfile.mkdtemp(prefix='priority-validation-')
    try:
        for s,f,seed in itertools.product(SERVERS,FRACTIONS,SEEDS):
            params={'servers':s,'customers':40,'arrival_rate':1,'service_rate':1,'high_priority_fraction':f}
            d=os.path.join(root,f'{s}-{f}-{seed}'); out,csv_path=run(d,params,seed); check(csv_path,params)
            out2,csv2=run(d,params,seed,'-repeat'); check(csv2,params)
            assert open(out,'rb').read()==open(out2,'rb').read()
            assert open(csv_path,'rb').read()==open(csv2,'rb').read()
        print('validated 18 configurations; reproducibility, arrival/priority order, waits, concurrency: ok')
    finally: shutil.rmtree(root)
if __name__=='__main__': main()
