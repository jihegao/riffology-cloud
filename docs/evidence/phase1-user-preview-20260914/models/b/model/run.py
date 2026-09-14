#!/usr/bin/env python3
"""Finite non-preemptive priority single-queue multi-server simulation."""
import argparse, csv, json, math, os, random


def positive(value, name):
    value = float(value)
    if not math.isfinite(value) or value <= 0:
        raise ValueError(name + " must be positive and finite")
    return value


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--input", required=True); ap.add_argument("--output", required=True)
    args = ap.parse_args()
    with open(args.input, encoding="utf-8") as f: request = json.load(f)
    p = request["parameters"]
    servers, customers = int(p.get("servers", 1)), int(p.get("customers", 40))
    arrival_rate, service_rate = positive(p.get("arrival_rate", 1), "arrival_rate"), positive(p.get("service_rate", 1), "service_rate")
    fraction = float(p.get("high_priority_fraction", 0.3))
    if not 1 <= servers <= 4 or not 1 <= customers <= 100: raise ValueError("integer parameter outside bounds")
    if not 0.1 <= arrival_rate <= 5 or not 0.1 <= service_rate <= 5 or not 0 <= fraction <= 1: raise ValueError("parameter outside bounds")
    rng = random.Random(request["seed"])
    arrivals, t = [], 0.0
    for _ in range(customers):
        t += rng.expovariate(arrival_rate); arrivals.append(t)
    priorities = ["high" if rng.random() < fraction else "regular" for _ in range(customers)]
    # Service durations are drawn at arrival, then the waiting set is selected by priority.
    durations = [rng.expovariate(service_rate) for _ in range(customers)]
    available = [0.0] * servers; waiting = []; rows = []; next_arrival = 0
    while next_arrival < customers or waiting:
        if next_arrival < customers and (not waiting or arrivals[next_arrival] <= min(available)):
            waiting.append(next_arrival); next_arrival += 1
            continue
        server = min(range(servers), key=lambda j: available[j])
        now = available[server]
        eligible = [i for i in waiting if arrivals[i] <= now]
        if not eligible:
            if next_arrival < customers:
                waiting.append(next_arrival); next_arrival += 1; continue
            eligible = waiting[:]
        chosen = min(eligible, key=lambda i: (0 if priorities[i] == "high" else 1, i))
        waiting.remove(chosen)
        start = max(arrivals[chosen], now); completion = start + durations[chosen]; available[server] = completion
        rows.append((chosen + 1, priorities[chosen], arrivals[chosen], start, completion, start - arrivals[chosen]))
    rows.sort(key=lambda r: r[0])
    waits = [r[5] for r in rows]; sojourns = [r[4] - r[2] for r in rows]
    high = [r[5] for r in rows if r[1] == "high"]; regular = [r[5] for r in rows if r[1] == "regular"]
    directory = os.path.dirname(os.path.abspath(args.output))
    with open(os.path.join(directory, "customers.csv"), "w", newline="", encoding="utf-8") as f:
        w = csv.writer(f); w.writerow(["customer", "priority", "arrival", "start", "completion", "wait"])
        for r in rows: w.writerow([r[0], r[1], *(f"{x:.9f}" for x in r[2:])])
    metrics = {"completed": float(customers), "mean_wait": sum(waits)/customers, "max_wait": max(waits), "mean_sojourn": sum(sojourns)/customers, "mean_wait_high": sum(high)/len(high) if high else 0.0, "mean_wait_regular": sum(regular)/len(regular) if regular else 0.0}
    with open(args.output, "w", encoding="utf-8") as f: json.dump({"schemaVersion": 1, "metrics": metrics, "outputs": ["customers.csv"]}, f, separators=(",", ":"))

if __name__ == "__main__": main()
