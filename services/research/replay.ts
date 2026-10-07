/** Portable replay helper shipped verbatim in each research package. */
export const REPLAY_PY=String.raw`#!/usr/bin/env python3
"""Verify an exported package and replay a completed Run in a new temporary directory."""
import argparse, hashlib, importlib.metadata, json, math, pathlib, subprocess, sys, tarfile, tempfile

def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()

def safe(root, name):
    path = pathlib.PurePosixPath(name)
    if path.is_absolute() or '..' in path.parts or '\\' in name:
        raise ValueError('unsafe-package-path')
    value = root.joinpath(*path.parts)
    if value.is_symlink() or not value.resolve().is_relative_to(root.resolve()):
        raise ValueError('unsafe-package-path')
    return value

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--run', help='Run ID; defaults to the first completed Run with a stored result')
    parser.add_argument('--verify-only', action='store_true')
    parser.add_argument('--allow-python-mismatch', action='store_true')
    args = parser.parse_args()
    root = pathlib.Path(__file__).resolve().parent
    manifest = json.loads((root / 'manifest.json').read_text())
    for item in manifest['files']:
        path = safe(root, item['path'])
        if path.stat().st_size != item['bytes'] or sha(path) != item['sha256']:
            raise ValueError('package-file-mismatch: ' + item['path'])
    if args.verify_only:
        print(json.dumps({'verified': True, 'exportId': manifest['exportId']})); return
    candidates = [r for r in manifest['runs'] if r['status'] == 'completed' and r['resultPath']]
    selected = next((r for r in candidates if r['runId'] == args.run), None) if args.run else next(iter(candidates), None)
    if selected is None:
        raise ValueError('no-completed-run-to-replay')
    run = json.loads(safe(root, selected['recordPath']).read_text())
    expected = json.loads(safe(root, selected['resultPath']).read_text())
    if selected['runId'] != run['runId'] or expected['runId'] != run['runId'] or expected['experimentId'] != run['experimentId'] or expected['version'] != run['version'] or expected['parameters'] != run['parameters'] or expected['seed'] != run['seed']:
        raise ValueError('run-identity-mismatch')
    source = next(s for s in manifest['sources'] if s['key'] == run['sourceKey'])
    spec = json.loads(safe(root, source['specPath']).read_text())
    python_version = sys.version.split()[0]
    if python_version != expected['pythonVersion'] and not args.allow_python_mismatch:
        raise ValueError('python-version-mismatch: expected ' + expected['pythonVersion'])
    compiler = source.get('compiler')
    if compiler:
        packages = {'sim-engine-compiler':'0.1.0', 'simpy':'4.1.1'}
        if spec['execution']['kind'] != 'compiler-v01' or expected.get('compiler', {}).get('bundleId') != compiler['bundleId']:
            raise ValueError('compiler-source-mismatch')
    else:
        lock = json.loads(safe(root, source['lockPath']).read_text())
        profile = source.get('executionProfile')
        packages = {item['name']:item['version'] for item in profile['dependencies']} if profile else lock['packages']
        if profile and lock['packages'] != profile['sourcePackages']:
            raise ValueError('dependency-profile-mismatch')
        if profile and python_version != profile['pythonVersion'] and not args.allow_python_mismatch:
            raise ValueError('execution-profile-python-mismatch')
    for package, version in packages.items():
        if importlib.metadata.version(package) != version:
            raise ValueError('dependency-version-mismatch: ' + package)
    with tempfile.TemporaryDirectory(prefix='riffology-replay-') as directory:
        work = pathlib.Path(directory); model = work / 'source'; model.mkdir(); output = work / 'output'; output.mkdir()
        with tarfile.open(safe(root, source['archivePath']), 'r:') as archive:
            for entry in archive.getmembers():
                target = safe(model, entry.name)
                if entry.isdir(): target.mkdir(parents=True, exist_ok=True)
                elif entry.isfile():
                    target.parent.mkdir(parents=True, exist_ok=True)
                    with archive.extractfile(entry) as stream: target.write_bytes(stream.read())
                else: raise ValueError('unsafe-source-entry')
        if compiler:
            from sim_engine_compiler import load_bundle, run_bundle, validate_business
            business_path = safe(model, spec['execution']['businessIr'])
            bundle_path = safe(model, spec['execution']['bundle'])
            business = json.loads(business_path.read_text())
            loaded = load_bundle(bundle_path)
            if sha(bundle_path) != compiler['bundleSha256'] or loaded.business != business or validate_business(business)['status'] != 'valid' or run['parameters']:
                raise ValueError('compiler-source-mismatch')
            product = run_bundle(bundle_path, seed=run['seed'], run_id=run['runId'], observation='summary')
            actual = product['model_identity']
            recorded = expected['compiler']
            identity = {'bundle_id': compiler['bundleId'], 'business_fingerprint': compiler['businessFingerprint'], 'plan_fingerprint': compiler['planFingerprint'], 'compiler_version': compiler['compilerVersion'], 'runtime_version': compiler['runtimeVersion'], 'domain_pack': compiler['domainPack'], 'ir_versions': compiler['irVersions'], 'execution_profile': compiler['executionProfile']}
            if (actual != identity or product['bundle_id'] != compiler['bundleId'] or product['result_sha256'] != recorded['resultSha256'] or product['result']['metrics']['stop_reason'] != recorded['stopReason'] or {key:recorded[key] for key in ['bundleSha256','bundleId','businessFingerprint','planFingerprint','compilerVersion','runtimeVersion','domainPack','irVersions','executionProfile']} != compiler):
                raise ValueError('compiler-result-mismatch')
            result = {'metrics':{name:product['result']['metrics'][name] for name in spec['metrics']}}
            declared_outputs = []
        else:
            input_path = work / 'input.json'
            input_path.write_text(json.dumps({'schemaVersion':1, 'runId':run['runId'], 'parameters':run['parameters'], 'seed':run['seed']}))
            result_path = output / 'result.json'
            subprocess.run([sys.executable, '-B', str(safe(model, spec['execution']['entrypoint'])), '--input', str(input_path), '--output', str(result_path)], cwd=model, check=True, timeout=600)
            if result_path.stat().st_size > 65536: raise ValueError('result-too-large')
            result = json.loads(result_path.read_text())
            if type(result) is not dict or set(result) not in ({'schemaVersion','metrics'}, {'schemaVersion','metrics','outputs'}) or type(result.get('schemaVersion')) is not int or result['schemaVersion'] != 1 or type(result.get('metrics')) is not dict:
                raise ValueError('result-contract-mismatch')
            declared_outputs = result.get('outputs', [])
        if type(declared_outputs) is not list or any(type(name) is not str for name in declared_outputs) or len(set(declared_outputs)) != len(declared_outputs) or set(declared_outputs) != {item['path'] for item in expected.get('outputs', [])}:
            raise ValueError('output-contract-mismatch')
        if set(result['metrics']) != set(spec['metrics']) or set(expected['metrics']) != set(spec['metrics']):
            raise ValueError('metric-contract-mismatch')
        comparisons = {}
        for name, reference in expected['metrics'].items():
            value = result['metrics'][name]
            match = type(value) in (int, float) and math.isfinite(value) and math.isclose(value, reference, rel_tol=1e-9, abs_tol=1e-9)
            comparisons[name] = {'expected': reference, 'actual': value, 'matches': match}
        output_checks = {item['path']: sha(safe(output, item['path'])) == item['sha256'] for item in expected.get('outputs', [])}
        report = {'exportId':manifest['exportId'], 'runId':run['runId'], 'pythonVersion':python_version, 'expectedPythonVersion':expected['pythonVersion'], 'metrics':comparisons, 'outputs':output_checks, 'matches':all(v['matches'] for v in comparisons.values()) and all(output_checks.values())}
        print(json.dumps(report, ensure_ascii=False, indent=2))
        if not report['matches']: raise SystemExit(1)
if __name__ == '__main__':
    main()
`;
export const EXPORT_README=`# riffoid research package

This ZIP is a snapshot of the saved project and all selected persisted research history at export time. Source archives and result envelopes retain their original bytes and digests. manifest.json inventories every included file. Internal sessions, authentication state and runtime control receipts are not exported.

1. Unpack the ZIP into a new directory.
2. Read manifest.json and the selected source's Model Spec under sources/, then inspect its environment entry.
3. Use the recorded Python version, preferably in a new virtual environment. For a compiler source, install sim-engine-compiler 0.1.0 and SimPy 4.1.1 for CPython 3.14.2 on linux/amd64; compiler-runtime.json records the image's pinned Python asset and wheel hashes, and compiler.json records the exact bundle identity. For a source with execution-profile.json, use its recorded linux/amd64 CPython and install the complete eight-package native closure with pip install --no-deps --only-binary=:all: --require-hashes -r environment/<source-key>/requirements.txt. The six-package project lock remains unchanged. For historical empty/SimPy sources, install their exact requirements.txt normally if nonempty.
4. Run python replay.py --verify-only to check every packaged file digest.
5. Run python replay.py --run RUN_ID (or omit --run for the first completed result).

The replay helper uses only the Python standard library except when replaying a compiler source, where it imports the installed public SDK. Model dependencies still need installation. It extracts the selected frozen source into a new temporary directory, executes that model with the recorded parameters and seed, and compares declared metrics with absolute and relative tolerance 1e-9. For compiler runs it also checks the bundle, Business and Plan fingerprints and the result digest. Declared output files must match SHA-256 exactly. A Python version mismatch is rejected by default; --allow-python-mismatch explicitly opts into an exploratory comparison and records the actual version. The recorded runtime image is provenance, not a promise that the cloud process sandbox exists locally.

A successful replay reproduces a computation; it does not certify assumptions or validate a scientific conclusion. Failed, cancelled, pending and rejected evidence remain in the inventory. Replaying a rejected model does not make it valid. Agent regeneration and chat history are outside the reproducibility promise. Each download fixes its own selection and timestamp; later runs, rejections or model edits are not retroactively added.
`;
