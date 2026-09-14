#!/usr/bin/env python3
"""Finite FCFS single-queue, multi-server simulation; standard library only."""
import argparse, csv, heapq, json, math, random


def positive_number(value, name):
    value = float(value)
    if not math.isfinite(value) or value <= 0:
        raise ValueError(name + " must be positive and finite")
    return value


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", required=True)
    parser.add_argument("--output", required=True)
    args = parser.parse_args()
    with open(args.input, encoding="utf-8") as f:
        request = json.load(f)
    p = request["parameters"]
    servers = int(p.get("servers", 1)); customers = int(p.get("customers", 40))
    arrival_rate = positive_number(p.get("arrival_rate", 1), "arrival_rate")
    service_rate = positive_number(p.get("service_rate", 1), "service_rate")
    if not 1 <= servers <= 4 or not 1 <= customers <= 100:
        raise ValueError("parameters outside supported bounds")
    if not 0.1 <= arrival_rate <= 5 or not 0.1 <= service_rate <= 5:
        raise ValueError("rates outside supported bounds")
    rng = random.Random(request["seed"])
    arrivals = []
    t = 0.0
    for i in range(customers):
        t += rng.expovariate(arrival_rate)
        arrivals.append(t)
    available = [0.0] * servers
    rows = []
    for i, arrival in enumerate(arrivals):
        server = min(range(servers), key=lambda j: available[j])
        start = max(arrival, available[server])
        completion = start + rng.expovariate(service_rate)
        available[server] = completion
        rows.append((i + 1, arrival, start, completion, start - arrival))
    waits = [r[4] for r in rows]
    sojourns = [r[3] - r[1] for r in rows]
    csv_path = args.output.rsplit("/", 1)[0] + "/customers.csv" if "/" in args.output else "customers.csv"
    with open(csv_path, "w", newline="", encoding="utf-8") as f:
        w = csv.writer(f); w.writerow(["customer","arrival","start","completion","wait"])
        for row in rows: w.writerow([row[0], *(f"{x:.9f}" for x in row[1:])])
    result = {"schemaVersion": 1, "metrics": {"completed": float(customers), "mean_wait": sum(waits)/customers, "max_wait": max(waits), "mean_sojourn": sum(sojourns)/customers}}
    with open(args.output, "w", encoding="utf-8") as f: json.dump(result, f, separators=(",", ":"))

if __name__ == "__main__": main()
