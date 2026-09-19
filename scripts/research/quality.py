"""Offline, inspectable checks derived from Issue 73. Never execute model code.

Findings are evidence/implementation defects or review requests, not a scientific
validity verdict. Frozen Issue 73 scores and manifests are never modified.
"""
import ast
import hashlib
import json
from pathlib import Path
import sys


def finding(code, detail, severity="error"):
    return {"code": code, "detail": detail, "severity": severity}


def dotted(node):
    if isinstance(node, ast.Name):
        return node.id
    if isinstance(node, ast.Attribute):
        return dotted(node.value) + "." + node.attr
    return ""


def audit_source(source, report=""):
    """Recognize explicit Mesa Model subclasses; dynamic aliases need review."""
    try:
        tree = ast.parse(source)
    except SyntaxError as error:
        return [finding("python-syntax", "line %s" % error.lineno)]
    bases = set()
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            for alias in node.names:
                if alias.name == "mesa":
                    bases.add((alias.asname or "mesa") + ".Model")
        if isinstance(node, ast.ImportFrom) and node.module in ("mesa", "mesa.model"):
            bases.update(alias.asname or alias.name for alias in node.names if alias.name == "Model")
    results = []
    calls = {id(node.func) for node in ast.walk(tree) if isinstance(node, ast.Call)}
    for node in ast.walk(tree):
        if isinstance(node, ast.ClassDef) and any(dotted(base) in bases for base in node.bases):
            for method in node.body:
                if not isinstance(method, (ast.FunctionDef, ast.AsyncFunctionDef)) or method.name != "step":
                    continue
                for statement in ast.walk(method):
                    targets = statement.targets if isinstance(statement, ast.Assign) else [statement.target] if isinstance(statement, (ast.AugAssign, ast.AnnAssign)) else []
                    if any(dotted(target) == "self.steps" for target in targets):
                        results.append(finding("mesa-managed-step-write", "line %s writes Mesa's managed step counter" % statement.lineno))
        if isinstance(node, ast.Attribute) and dotted(node) == "self.random.seed" and id(node) not in calls:
            results.append(finding("seed-method-value", "line %s uses the seed method as a value; inspect exported seed fields" % node.lineno, "review"))
    if any(word in report.lower() for word in ("shuffle", "随机激活", "随机顺序")):
        # A call's presence cannot prove execution. Require an activation trace
        # or source review even when shuffle_do/shuffle appears in the AST.
        results.append(finding("activation-claim-needs-evidence", "Match the claimed activation order to implementation and a recorded trace", "review"))
    return results


def audit_rows(rows, expected_seeds, expected_steps=None):
    results = []
    if not rows:
        return [finding("results-empty", "No executed result rows supplied")]
    for index, row in enumerate(rows):
        seed = row.get("seed")
        if type(seed) is not int or seed not in expected_seeds:
            results.append(finding("seed-invalid", "row %s has no numeric seed from the declared set" % index))
        if expected_steps is not None:
            steps = row.get("steps")
            if type(steps) is not int or steps != expected_steps:
                results.append(finding("step-count-mismatch", "row %s differs from the specified fixed horizon" % index))
        # Only compare with independently supplied execution observations.
        if "observedUpdates" in row and (type(row["observedUpdates"]) is not int or row.get("steps") != row["observedUpdates"]):
            results.append(finding("step-observation-mismatch", "row %s counter disagrees with observed model updates" % index))
    if set(expected_seeds) - {row.get("seed") for row in rows if type(row.get("seed")) is int}:
        results.append(finding("seed-coverage-missing", "At least one declared seed has no result"))
    return results


def audit_history(previous, current):
    """Maps contain result bytes; retain old path AND content, not only a hash."""
    results = []
    for path, content in previous.items():
        if path not in current:
            results.append(finding("historical-result-missing", path))
        elif hashlib.sha256(content).digest() != hashlib.sha256(current[path]).digest():
            results.append(finding("historical-result-overwritten", path))
    return results


def command_evidence(declared, observed_commands):
    """Never execute or infer shell control flow from substrings."""
    if not isinstance(declared, str) or not declared.strip() or "..." in declared:
        return {"status": "invalid", "reason": "incomplete-command", "fabricatedNumericResult": False}
    if declared.strip() in [command.strip() for command in observed_commands]:
        return {"status": "matched", "reason": "exact-command", "fabricatedNumericResult": False}
    return {"status": "review", "reason": "command-evidence-unmatched", "fabricatedNumericResult": False}


def main():
    if len(sys.argv) != 2:
        raise SystemExit("usage: python3 scripts/research/quality.py SOURCE.py")
    results = audit_source(Path(sys.argv[1]).read_text())
    print(json.dumps({"scope": "static source review only; no scientific acceptance", "findings": results}, indent=2))
    return int(bool(results))


if __name__ == "__main__":
    sys.exit(main())
