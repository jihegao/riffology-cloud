#!/usr/bin/env python3
"""Independent checks for the finite priority multi-server CSV contract."""
import argparse
import csv
import math
import sys

EPS = 1e-7


def fail(errors, message):
    errors.append(message)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("csv_path")
    ap.add_argument("--servers", type=int, required=True)
    ap.add_argument("--eps", type=float, default=EPS)
    args = ap.parse_args()
    if args.servers < 1 or args.eps <= 0:
        print("invalid checker arguments", file=sys.stderr)
        return 2
    with open(args.csv_path, newline="", encoding="utf-8") as fh:
        rows = list(csv.DictReader(fh))
    required = {"customer", "priority", "arrival", "start", "completion", "wait"}
    if not rows or not required.issubset(rows[0]):
        print("FAIL missing required CSV columns or empty CSV")
        return 1
    errors = []
    parsed = []
    ids = set()
    for line, row in enumerate(rows, 2):
        try:
            customer = int(row["customer"])
            arrival = float(row["arrival"])
            start = float(row["start"])
            completion = float(row["completion"])
            wait = float(row["wait"])
        except (KeyError, TypeError, ValueError):
            fail(errors, f"line {line}: non-numeric required field")
            continue
        if customer in ids:
            fail(errors, f"line {line}: duplicate customer {customer}")
        ids.add(customer)
        if not all(math.isfinite(x) for x in (arrival, start, completion, wait)):
            fail(errors, f"line {line}: non-finite time")
            continue
        priority = row["priority"]
        if priority not in ("high", "regular"):
            fail(errors, f"line {line}: invalid priority {priority!r}")
        if start < arrival - args.eps:
            fail(errors, f"customer {customer}: start before arrival")
        if completion < start - args.eps:
            fail(errors, f"customer {customer}: completion before start")
        if abs(wait - (start - arrival)) > args.eps:
            fail(errors, f"customer {customer}: wait != start-arrival")
        parsed.append({"customer": customer, "priority": priority, "arrival": arrival,
                       "start": start, "completion": completion})
    if not parsed:
        print("FAIL no parseable rows")
        return 1

    # Sweep service intervals. Completions at t free capacity before starts at t.
    events = sorted([(r["start"], 1, r["customer"]) for r in parsed] +
                    [(r["completion"], -1, r["customer"]) for r in parsed],
                    key=lambda e: (e[0], e[1]))
    active = 0
    for time, kind, customer in events:
        active += kind
        if active < 0 or active > args.servers:
            fail(errors, f"time {time:.9f}: concurrency {active} exceeds server capacity")

    # At each start time, the selected customer must not be lower priority than
    # any already-arrived customer still waiting. Starts within EPS are one
    # simultaneous dispatch wave, so their relative order is intentionally free.
    starts = sorted(parsed, key=lambda r: (r["start"], r["customer"]))
    for index, current in enumerate(starts):
        t = current["start"]
        waiting = [r for r in parsed if r["arrival"] <= t + args.eps and r["start"] > t + args.eps]
        # Same-time starts are selected in deterministic order after each slot.
        earlier_same = [r for r in starts[:index] if abs(r["start"] - t) <= args.eps]
        waiting = [r for r in waiting if r not in earlier_same]
        if waiting:
            key = lambda r: (0 if r["priority"] == "high" else 1, r["arrival"], r["customer"])
            if key(current) > min(map(key, waiting)):
                fail(errors, f"customer {current['customer']}: priority/FIFO dispatch violates arrived waiting set at {t:.9f}")

    # Work-conserving: after each completion/arrival boundary, every available
    # server must be used whenever an arrived, not-yet-started customer waits.
    boundaries = sorted({r["arrival"] for r in parsed} | {r["start"] for r in parsed} |
                        {r["completion"] for r in parsed})
    for t in boundaries:
        waiting = [r for r in parsed if r["arrival"] <= t + args.eps and r["start"] > t + args.eps]
        active_after = sum(1 for r in parsed if r["start"] <= t + args.eps and r["completion"] > t + args.eps)
        if waiting and active_after < args.servers:
            fail(errors, f"time {t:.9f}: idle server while an arrived customer waits")

    if errors:
        print(f"FAIL {len(errors)}")
        for error in errors[:20]:
            print(error)
        if len(errors) > 20:
            print(f"... {len(errors) - 20} more")
        return 1
    print(f"PASS rows={len(parsed)} servers={args.servers} eps={args.eps:g}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
