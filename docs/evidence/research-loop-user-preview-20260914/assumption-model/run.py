#!/usr/bin/env python3
"""Finite multi-server FIFO checkout simulation with bounded waiting room and deterministic service."""
import argparse
import csv
import heapq
import json
import math
import random
from pathlib import Path


def positive_number(value, name):
    value = float(value)
    if not math.isfinite(value) or value <= 0:
        raise ValueError(f"{name} must be finite and positive")
    return value


def simulate(parameters):
    servers = int(parameters["servers"])
    customers = int(parameters["customers"])
    queue_capacity = int(parameters["queue_capacity"])
    arrival_rate = positive_number(parameters["arrival_rate"], "arrival_rate")
    service_rate = positive_number(parameters["service_rate"], "service_rate")
    if not 1 <= servers <= 8 or not 1 <= customers <= 100000 or not 0 <= queue_capacity <= 100000:
        raise ValueError("parameter outside supported bounds")

    rng = random.Random(parameters["_top_level_seed"])
    available = [(0.0, server_id) for server_id in range(servers)]
    heapq.heapify(available)
    waiting = []
    arrival_time = 0.0
    rows = []
    busy_total = 0.0
    wait_total = 0.0
    served = 0
    balked = 0
    last_completion = 0.0

    def start_customer(customer):
        nonlocal busy_total, wait_total, served, last_completion
        server_free, server_id = heapq.heappop(available)
        start = max(customer["arrival_time"], server_free)
        wait = start - customer["arrival_time"]
        service = customer["service_time"]
        finish = start + service
        heapq.heappush(available, (finish, server_id))
        busy_total += service
        wait_total += wait
        served += 1
        last_completion = max(last_completion, finish)
        customer.update(status="served", server=server_id + 1, service_start=start,
                        completion_time=finish, wait=wait)

    for customer_id in range(1, customers + 1):
        arrival_time += rng.expovariate(arrival_rate)
        service_time = 1.0 / service_rate
        customer = {"customer_id": customer_id, "arrival_time": arrival_time,
                     "service_time": service_time}
        # First drain any queued customers whenever a server is free at this arrival.
        while waiting and available and available[0][0] <= arrival_time:
            start_customer(waiting.pop(0))
        if available and available[0][0] <= arrival_time:
            start_customer(customer)
        elif len(waiting) < queue_capacity:
            customer.update(status="waiting", server="", service_start="", completion_time="", wait="")
            waiting.append(customer)
        else:
            balked += 1
            customer.update(status="balked", server="", service_start="", completion_time="", wait="")
        rows.append(customer)

    while waiting:
        start_customer(waiting.pop(0))
    horizon = last_completion
    metrics = {
        "mean_wait": wait_total / served if served else 0.0,
        "throughput": served / horizon if horizon else 0.0,
        "utilization": busy_total / (servers * horizon) if horizon else 0.0,
        "served_customers": served,
        "balked_customers": balked,
        "balk_rate": balked / customers,
    }
    return metrics, rows


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", required=True)
    parser.add_argument("--output", required=True)
    args = parser.parse_args()
    payload = json.loads(Path(args.input).read_text(encoding="utf-8"))
    parameters = dict(payload["parameters"])
    parameters["_top_level_seed"] = int(payload["seed"])
    metrics, rows = simulate(parameters)
    output = Path(args.output)
    with output.with_name("summary.csv").open("w", newline="", encoding="utf-8") as handle:
        writer = csv.writer(handle)
        writer.writerow(["customer_id", "arrival_time", "status", "server", "service_start", "completion_time", "wait", "service_time"])
        for row in rows:
            writer.writerow([row[k] for k in ("customer_id", "arrival_time", "status", "server", "service_start", "completion_time", "wait", "service_time")])
    output.write_text(json.dumps({"schemaVersion": 1, "metrics": metrics, "outputs": ["summary.csv"]}, sort_keys=True) + "\n", encoding="utf-8")


if __name__ == "__main__":
    main()
