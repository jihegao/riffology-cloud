import heapq
import random


def run(config):
    parameters = config['parameters']
    customers = int(parameters['customers'])
    servers = int(parameters['servers'])
    arrival_rate = float(parameters['arrival_rate'])
    service_rate = float(parameters['service_rate'])
    # The fixture builder substitutes the two explicit mechanism controls.
    max_wait = None  # BENCHMARK_ABANDONMENT
    queue_capacity = None  # BENCHMARK_CAPACITY
    rng = random.Random(int(config['seed']))
    arrivals = []
    now = 0.0
    for customer in range(1, customers + 1):
        now += rng.expovariate(arrival_rate)
        arrivals.append((now, customer, rng.expovariate(service_rate)))
    available = [(0.0, server + 1) for server in range(servers)]
    heapq.heapify(available)
    records = []
    for arrival, customer, service in arrivals:
        waiting = sum(r['arrival'] <= arrival < r['queue_end'] for r in records)
        if queue_capacity is not None and waiting >= queue_capacity and available[0][0] > arrival:
            records.append(dict(id=customer, arrival=arrival, queue_end=arrival, departure=arrival, status='rejected', wait=0.0, server=None))
            continue
        free_at, server = heapq.heappop(available)
        start = max(arrival, free_at)
        wait = start - arrival
        if max_wait is not None and wait > max_wait:
            departure = arrival + max_wait
            records.append(dict(id=customer, arrival=arrival, queue_end=departure, departure=departure, status='abandoned', wait=max_wait, server=None))
            heapq.heappush(available, (free_at, server))
        else:
            finish = start + service
            records.append(dict(id=customer, arrival=arrival, queue_end=start, departure=finish, status='completed', wait=wait, server=server))
            heapq.heappush(available, (finish, server))
    events = sorted({0.0, *[r['arrival'] for r in records], *[r['queue_end'] for r in records], *[r['departure'] for r in records]})
    completed_records = [r for r in records if r['status'] == 'completed']
    horizon = events[-1]
    mean_wait = sum(r['wait'] for r in completed_records) / len(completed_records) if completed_records else 0.0
    snapshots = []
    for frame, time in enumerate(events):
        agents = []
        for record in records:
            if not record['arrival'] <= time < record['departure']:
                continue
            waiting = time < record['queue_end']
            agents.append(dict(id=str(record['id']), type='customer', state='waiting' if waiting else 'serving', lane='queue' if waiting else f"server-{record['server']}", position=len(agents) + 1 if waiting else 1))
        metrics = dict(queue_length=sum(a['state'] == 'waiting' for a in agents), completed=sum(r['status'] == 'completed' and r['departure'] <= time for r in records), mean_wait=mean_wait, throughput=len(completed_records) / horizon if horizon else 0.0)
        if max_wait is not None:
            metrics['abandoned'] = sum(r['status'] == 'abandoned' and r['departure'] <= time for r in records)
        if queue_capacity is not None:
            metrics['rejected'] = sum(r['status'] == 'rejected' and r['departure'] <= time for r in records)
        snapshots.append(dict(schemaVersion='riffology.visual/v0.1', frame=frame, time=time, space=dict(type='lane', lanes=['queue', *[f'server-{i + 1}' for i in range(servers)]]), agents=agents, metrics=metrics))
    return dict(model='offline-queue-benchmark-reference', snapshots=snapshots)
