# Artifact contract

For each Turn `N`, create both of these files:

- `/workspace/outputs/turn-N-project.zip`: a ZIP of the complete editable
  `/workspace/project` directory, including source, tests, machine-readable raw
  results, derived summaries, plots, and reports available at that Turn.
- `/workspace/outputs/turn-N-manifest.json`: UTF-8 JSON matching the schema below.

The manifest must have this shape:

```json
{
  "schemaVersion": 1,
  "fixtureVersion": "schelling-v1",
  "turn": 1,
  "executed": true,
  "runtime": {
    "python": "actual version",
    "mesa": "actual version"
  },
  "verificationCommands": [
    {"command": "exact executed command", "exitCode": 0}
  ],
  "workspaceFiles": [
    {
      "path": "path relative to /workspace/project",
      "kind": "source|config|test|result|plot|report|other",
      "sha256": "64 lowercase hex characters"
    }
  ],
  "experiment": {
    "parametersVaried": ["parameter names"],
    "parameterValues": {"parameter": [0.1, 0.2]},
    "seeds": [101, 202, 303],
    "steps": 50,
    "primaryMetrics": ["metric names"],
    "runCount": 12
  },
  "changes": {
    "inspectedFiles": ["relative paths"],
    "modifiedFiles": ["relative paths"]
  },
  "assumptions": ["..."],
  "limitations": ["..."]
}
```

Hash every regular file included in the project ZIP and list it exactly once in
`workspaceFiles`. `verificationCommands` must contain commands actually executed
in this Turn with their real exit codes. Use Python's standard library or another
available local tool to create the ZIP. Read back the manifest and ZIP listing
before completing the Turn.

Classify Python model and experiment-runner files as `source`, Python test files
as `test`, CSV/JSON experiment outputs as `result`, plots as `plot`, and Markdown
analysis as `report`. Keep a file's classification stable across Turns unless
its actual role changes; in particular, an existing model or runner `.py` file
must remain `source` after it is edited.

The caller independently scores modeling-methodology dimensions from the
project report, executed commands, raw run files, seeds, parameter coverage,
and artifact contents. Do not add fields solely to anticipate the evaluator.
