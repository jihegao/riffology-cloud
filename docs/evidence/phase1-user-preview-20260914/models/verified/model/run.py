#!/usr/bin/env python3
"""Finite non-preemptive priority single-queue multi-server simulation."""
import argparse, csv, json, math, os, random

def positive(value, name):
    value = float(value)
    if not math.isfinite(value) or value <= 0: raise ValueError(name + " must be positive and finite")
    return value

def main():
    ap = argparse.ArgumentParser(); ap.add_argument('--input', required=True); ap.add_argument('--output', required=True); args = ap.parse_args()
    with open(args.input, encoding='utf-8') as f: request = json.load(f)
    p = request['parameters']; servers=int(p.get('servers',1)); customers=int(p.get('customers',40))
    ar=positive(p.get('arrival_rate',1),'arrival_rate'); sr=positive(p.get('service_rate',1),'service_rate'); frac=float(p.get('high_priority_fraction',.3))
    if not 1<=servers<=4 or not 1<=customers<=100 or not .1<=ar<=5 or not .1<=sr<=5 or not 0<=frac<=1: raise ValueError('parameter outside bounds')
    rng=random.Random(request['seed']); arrivals=[]; t=0.0
    for _ in range(customers): t += rng.expovariate(ar); arrivals.append(t)
    priorities=['high' if rng.random()<frac else 'regular' for _ in range(customers)]
    durations=[rng.expovariate(sr) for _ in range(customers)]
    available=[0.0]*servers; waiting=[]; rows=[]; next_i=0
    while next_i<customers or waiting:
        # Advance to the next event only when no customer is currently eligible.
        eligible=[i for i in waiting if arrivals[i] <= min(available)]
        if not eligible:
            if next_i<customers:
                now=arrivals[next_i]
                waiting.extend(range(next_i, next_i+1)); next_i += 1
                while next_i<customers and arrivals[next_i] <= now: waiting.append(next_i); next_i += 1
                eligible=[i for i in waiting if arrivals[i] <= now]
            else: eligible=waiting[:]
        server=min(range(servers), key=lambda j: available[j]); now=max(available[server], arrivals[eligible[0]])
        eligible=[i for i in waiting if arrivals[i] <= now]
        if not eligible: continue
        chosen=min(eligible, key=lambda i:(0 if priorities[i]=='high' else 1, arrivals[i], i)); waiting.remove(chosen)
        start=max(arrivals[chosen], available[server]); completion=start+durations[chosen]; available[server]=completion
        rows.append((chosen+1, priorities[chosen], arrivals[chosen], start, completion, start-arrivals[chosen]))
    rows.sort(); waits=[r[5] for r in rows]; soj=[r[4]-r[2] for r in rows]; high=[r[5] for r in rows if r[1]=='high']; regular=[r[5] for r in rows if r[1]=='regular']
    directory=os.path.dirname(os.path.abspath(args.output))
    with open(os.path.join(directory,'customers.csv'),'w',newline='',encoding='utf-8') as f:
        w=csv.writer(f); w.writerow(['customer','priority','arrival','start','completion','wait'])
        for r in rows: w.writerow([r[0],r[1],*(f'{x:.9f}' for x in r[2:])])
    metrics={'completed':float(customers),'mean_wait':sum(waits)/customers,'max_wait':max(waits),'mean_sojourn':sum(soj)/customers,'mean_wait_high':sum(high)/len(high) if high else 0.0,'mean_wait_regular':sum(regular)/len(regular) if regular else 0.0}
    with open(args.output,'w',encoding='utf-8') as f: json.dump({'schemaVersion':1,'metrics':metrics,'outputs':['customers.csv']},f,separators=(',',':'))
if __name__=='__main__': main()
