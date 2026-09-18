# Offline research-quality regression

Issue 73 completed its authorized A/B matrix with the decision
`retain-current-runtime`. Twelve terminal Turns and matching ZIP hashes do not
prove model correctness; strict accepted tasks were 0/2 in each condition.
The imported ADR and frozen reports are preserved byte-for-byte.

`npm run test:research-quality` checks a small set of defects observed in that
experiment. `python3 scripts/research/quality.py SOURCE.py` inspects a Python
source file without importing or executing it. It emits findings to stdout and
returns nonzero when findings require correction or review.

| Check | Evidence required / limitation |
| --- | --- |
| Mesa managed step counter | AST finds writes to `self.steps` in direct Mesa Model subclasses, including import aliases; dynamic or indirect inheritance still requires review |
| Seed values | AST flags a seed method used as a value; result-row check requires integer seeds from the declared set and complete seed coverage |
| Step counts | Fixed-horizon check plus independently supplied observed update counts; self-reported counters alone do not establish executed updates |
| Activation/report consistency | An activation claim always needs trace/source review; finding a shuffle call does not prove it ran |
| Historical results | Compare exact old result paths and bytes; overwrites or disappearing paths are reported |
| Command evidence | Exact matches are recorded; larger shell wrappers, missing matches and abbreviated commands require review, never an automatic numerical fabrication accusation |

The row/history/command functions are offline inspection helpers, not a new
public API or a platform-wide scientific validator. No production admission or
frozen experiment score depends on them. Queue publication still requires
ordinary-user actual execution, numerical review, export replay and independent
approval under [the research protocol](invited-queue-research.md).
