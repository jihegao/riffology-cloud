#!/usr/bin/env python3
"""riffology.model-run/v1: shared Python model to finite server result.

Saved as model/run.py beside model.py and model-spec.json. No browser result is
accepted. The server invokes the same run(config) again under its process fence.
"""
import argparse
import json
from pathlib import Path
from model import run


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--input', required=True)
    parser.add_argument('--output', required=True)
    args = parser.parse_args()
    input_data = json.loads(Path(args.input).read_text())
    if set(input_data) != {'schemaVersion', 'runId', 'parameters', 'seed'} or input_data['schemaVersion'] != 1:
        raise ValueError('invalid-model-input')
    config = {'parameters': input_data['parameters'], 'seed': input_data['seed']}
    if type(config['parameters']) is not dict or type(config['seed']) is not int or not 0 <= config['seed'] <= 4294967295:
        raise ValueError('invalid-model-input')
    trace = run(config)
    if type(trace) is not dict or set(trace) != {'model', 'snapshots'} or type(trace['snapshots']) is not list or not trace['snapshots']:
        raise ValueError('invalid-model-trace')
    # Validate serialization before selecting metrics: no NaN/Infinity anywhere.
    trace_bytes = json.dumps(trace, sort_keys=True, separators=(',', ':'), allow_nan=False).encode('utf-8')
    if len(trace_bytes) > 8 * 1024 * 1024 or len(trace['snapshots']) > 501:
        raise ValueError('model-trace-too-large')
    final = trace['snapshots'][-1]
    spec = json.loads(Path(__file__).with_name('model-spec.json').read_text())
    metrics = {name: final['metrics'][name] for name in spec['metrics']}
    if any(type(value) not in (int, float) for value in metrics.values()):
        raise ValueError('invalid-model-metrics')
    output = Path(args.output)
    summary = {'schemaVersion': 1, 'model': trace['model'], 'frame': final['frame'], 'time': final['time'], 'parameters': config['parameters'], 'seed': config['seed'], 'metrics': metrics}
    summary_bytes = json.dumps(summary, sort_keys=True, separators=(',', ':'), allow_nan=False).encode('utf-8')
    if len(summary_bytes) > 16384:
        raise ValueError('model-summary-too-large')
    output.with_name('summary.json').write_bytes(summary_bytes)
    outputs = ['summary.json']
    # A full trace is optional; no partial/truncated trace is ever persisted.
    if len(trace_bytes) <= 16384 and len(trace_bytes) + len(summary_bytes) <= 32768:
        output.with_name('trace.json').write_bytes(trace_bytes)
        outputs.append('trace.json')
    output.write_text(json.dumps({'schemaVersion': 1, 'metrics': metrics, 'outputs': outputs}, allow_nan=False, separators=(',', ':')))


if __name__ == '__main__':
    main()
