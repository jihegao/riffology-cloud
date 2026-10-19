"""Prepare the portable compilation SDK from the pinned, reviewed wheel.

The wheel's Linux native extension is excluded on other platforms. This setup
supports seal/validate/compile/inspect, never native simulation execution.
"""
import argparse
import hashlib
import json
import subprocess
import sys
import zipfile
from pathlib import Path

parser = argparse.ArgumentParser()
parser.add_argument("--wheel", required=True, type=Path)
parser.add_argument("--destination", default=".compiler", type=Path)
args = parser.parse_args()
expected = "e7bcd9271dd42106b78e87176e3485b290536f5291c0440872b814fc549858f7"
if hashlib.sha256(args.wheel.read_bytes()).hexdigest() != expected:
    parser.error("wheel SHA-256 differs from the v0.2 contract")
target = args.destination.resolve()
sdk = target / "python"
sdk.mkdir(parents=True, exist_ok=True)
with zipfile.ZipFile(args.wheel) as archive:
    for name in archive.namelist():
        if name.startswith("sim_engine_compiler/") and name.endswith((".py", ".json")):
            path = sdk / name
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_bytes(archive.read(name))
subprocess.run([sys.executable, "-m", "pip", "install", "--disable-pip-version-check",
                "--target", str(sdk), "simpy==4.1.1"], check=True)
(target / "config.json").write_text(json.dumps({
    "python": sys.executable, "pythonPath": str(sdk), "compilerVersion": "0.1.0",
    "wheelSha256": expected, "mode": "portable-compilation-sdk",
}, indent=2) + "\n")
print("Compiler SDK ready: " + str(target))
