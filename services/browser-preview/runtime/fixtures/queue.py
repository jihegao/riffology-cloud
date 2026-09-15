import heapq
import json
import random


def run(config):
    params = config.get("parameters", {})
    servers = max(1, min(int(params.get("servers", 2)), 8))
    customers = max(1, min(int(params.get("customers", 30)), 200))
    arrival_rate = max(0.01, float(params.get("arrival_rate", 0.8)))
    service_rate = max(0.01, float(params.get("service_rate", 1.0)))
    seed = int(config.get("seed", 1))
    rng = random.Random(seed)

    arrivals = []
    t = 0.0
    for customer_id in range(1, customers + 1):
        t += rng.expovariate(arrival_rate)
        arrivals.append((t, customer_id, rng.expovariate(service_rate)))

    server_heap = [(0.0, server_id + 1) for server_id in range(servers)]
    heapq.heapify(server_heap)
    records = []
    wait_total = 0.0
    for arrival, customer_id, service in arrivals:
        available_at, server_id = heapq.heappop(server_heap)
        start = max(arrival, available_at)
        finish = start + service
        wait = start - arrival
        wait_total += wait
        heapq.heappush(server_heap, (finish, server_id))
        records.append({
            "id": customer_id,
            "arrival": arrival,
            "start": start,
            "finish": finish,
            "server": server_id,
            "wait": wait,
        })

    event_times = sorted({0.0, *[r["arrival"] for r in records], *[r["start"] for r in records], *[r["finish"] for r in records]})
    snapshots = []
    horizon = max(r["finish"] for r in records)
    for frame, now in enumerate(event_times[:500]):
        agents = []
        queue_position = 0
        for record in records:
            if now < record["arrival"] or now >= record["finish"]:
                continue
            if now < record["start"]:
                queue_position += 1
                agents.append({
                    "id": str(record["id"]),
                    "type": "customer",
                    "state": "waiting",
                    "lane": "queue",
                    "position": queue_position,
                })
            else:
                agents.append({
                    "id": str(record["id"]),
                    "type": "customer",
                    "state": "serving",
                    "lane": f"server-{record['server']}",
                    "position": 1,
                })
        completed = sum(1 for record in records if record["finish"] <= now)
        snapshots.append({
            "schemaVersion": "riffology.visual/v0.1",
            "frame": frame,
            "time": now,
            "space": {"type": "lane", "lanes": ["queue", *[f"server-{i + 1}" for i in range(servers)]]},
            "agents": agents,
            "metrics": {
                "queue_length": sum(1 for agent in agents if agent["state"] == "waiting"),
                "completed": completed,
                "mean_wait": wait_total / customers,
                "throughput": customers / horizon if horizon else 0.0,
            },
        })

    return {"model": "python-queue-trace", "snapshots": snapshots}

