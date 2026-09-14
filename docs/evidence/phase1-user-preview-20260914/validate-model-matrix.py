#!/usr/bin/env python3
"""Run the independent queue CSV checks against a model tarball locally."""
import argparse
import hashlib
import json
import subprocess
import sys
import tarfile
import tempfile
import time
from pathlib import Path


TIMEOUT_SECONDS = 10


def configurations():
    main = [
        {"servers": servers, "customers": 40, "arrival_rate": 1, "service_rate": 1,
         "high_priority_fraction": fraction, "seed": seed}
        for servers in (1, 2, 4)
        for fraction in (0, 0.3, 1)
        for seed in (99, 20260914)
    ]
    edge = [
        {"servers": 1, "customers": 1, "arrival_rate": 0.1, "service_rate": 5,
         "high_priority_fraction": 0, "seed": 99},
        {"servers": 4, "customers": 1, "arrival_rate": 5, "service_rate": 0.1,
         "high_priority_fraction": 1, "seed": 20260914},
        {"servers": 1, "customers": 100, "arrival_rate": 5, "service_rate": 0.1,
         "high_priority_fraction": 0.3, "seed": 99},
        {"servers": 4, "customers": 100, "arrival_rate": 0.1, "service_rate": 5,
         "high_priority_fraction": 0.7, "seed": 20260914},
    ]
    return main + edge


def sha256(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def run_one(entrypoint, checker, parameters, directory, repetition):
    inp = directory / "input.json"
    result = directory / "result.json"
    model_parameters = {key: value for key, value in parameters.items() if key != "seed"}
    inp.write_text(json.dumps({"seed": parameters["seed"], "parameters": model_parameters}) + "\n")
    try:
        proc = subprocess.run(
            [sys.executable, str(entrypoint), "--input", str(inp), "--output", str(result)],
            cwd=directory, capture_output=True, text=True, timeout=TIMEOUT_SECONDS,
        )
    except subprocess.TimeoutExpired:
        return {"repetition": repetition, "status": "timeout", "timeoutSeconds": TIMEOUT_SECONDS}
    row = {"repetition": repetition, "exitCode": proc.returncode}
    csv_path = directory / "customers.csv"
    if proc.returncode != 0 or not result.exists() or not csv_path.exists():
        row["status"] = "execution-failed"
        return row
    try:
        check = subprocess.run(
            [sys.executable, str(checker), str(csv_path), "--servers", str(parameters["servers"])],
            capture_output=True, text=True, timeout=TIMEOUT_SECONDS,
        )
    except subprocess.TimeoutExpired:
        return {"repetition": repetition, "status": "checker-timeout", "timeoutSeconds": TIMEOUT_SECONDS}
    try:
        value = json.loads(result.read_text())
    except (OSError, ValueError):
        return {"repetition": repetition, "status": "invalid-result"}
    row.update({
        "status": "pass" if check.returncode == 0 else "checker-failed",
        "checkerExitCode": check.returncode,
        "checkerFirstLine": check.stdout.splitlines()[:1],
        "csvSha256": sha256(csv_path),
        "metrics": value.get("metrics"),
    })
    return row


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("tar_path")
    ap.add_argument("report_path")
    args = ap.parse_args()
    tar_path = Path(args.tar_path).resolve()
    report_path = Path(args.report_path).resolve()
    checker = Path(__file__).resolve().with_name("verify-queue.py")
    if not tar_path.is_file() or not checker.is_file():
        print("missing tar or independent checker", file=sys.stderr)
        return 2
    with tempfile.TemporaryDirectory(prefix="model-matrix-") as tmp:
        root = Path(tmp)
        with tarfile.open(tar_path) as archive:
            candidates = [member for member in archive.getmembers() if member.name == "model/run.py"]
            if len(candidates) != 1 or not candidates[0].isreg() or candidates[0].size > 256 * 1024:
                print("tar must contain one regular model/run.py <= 256 KiB", file=sys.stderr)
                return 2
            entrypoint = root / "model" / "run.py"
            entrypoint.parent.mkdir()
            extracted = archive.extractfile(candidates[0])
            if extracted is None:
                print("cannot read regular model/run.py", file=sys.stderr)
                return 2
            entrypoint.write_bytes(extracted.read())
        if not entrypoint.is_file() or entrypoint.is_symlink():
            print("missing model/run.py in tar", file=sys.stderr)
            return 2
        cases = []
        for index, parameters in enumerate(configurations(), 1):
            runs = []
            for repetition in (1, 2):
                directory = root / f"case-{index}-run-{repetition}"
                directory.mkdir()
                runs.append(run_one(entrypoint, checker, parameters, directory, repetition))
            cases.append({
                "seed": parameters["seed"],
                "parameters": {key: value for key, value in parameters.items() if key != "seed"},
                "runs": runs,
                "repeatCsvEqual": runs[0].get("csvSha256") == runs[1].get("csvSha256"),
                "repeatMetricsEqual": runs[0].get("metrics") == runs[1].get("metrics"),
            })
    report = {
        "schemaVersion": 1,
        "artifact": tar_path.name,
        "tarSha256": sha256(tar_path),
        "validation": "local-only-independent-csv-checker",
        "observedAt": int(time.time() * 1000),
        "repetitions": 2,
        "perRunTimeoutSeconds": TIMEOUT_SECONDS,
        "configurationCount": len(cases),
        "allChecksPass": all(
            case["repeatCsvEqual"] and case["repeatMetricsEqual"] and
            all(run.get("status") == "pass" for run in case["runs"])
            for case in cases
        ),
        "cases": cases,
    }
    report_path.parent.mkdir(parents=True, exist_ok=True)
    report_path.write_text(json.dumps(report, indent=2) + "\n")
    print(json.dumps({"report": str(report_path), "allChecksPass": report["allChecksPass"], "configurationCount": len(cases)}))
    return 0 if report["allChecksPass"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
