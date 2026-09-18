# Local branch disposition — 2026-09-19

Baseline main: `727c40f`. Read-only audit; original branches and worktrees retained.

| Branch | Behind / ahead | Changed paths identical to main | Remaining path differences | Missing from main |
| --- | --- | --- | --- | --- |
| `codex/g5-authority-rpc` | 91 / 6 | 11 | 24 | 0 |
| `codex/g5-b2-authority-preserved` | 74 / 3 | 18 | 23 | 0 |
| `codex/g5-b2-readonly-proof` | 74 / 3 | 0 | 15 | 0 |
| `codex/g5-b2-simulation-output` | 74 / 1 | 18 | 14 | 0 |
| `codex/g5-bounded-unsettled` | 0 / 0 | 0 | 0 | 0 |
| `codex/g5-fixture-workflow` | 91 / 4 | 2 | 13 | 0 |
| `codex/g5-runtime-observation` | 142 / 7 | 9 | 0 | 0 |
| `codex/g5-upstream-http-evidence` | 31 / 1 | 0 | 0 | 2 |
| `codex/issue-73-luna-agents-experiment` | 273 / 1 | 0 | 3 | 48 |
| `codex/issues-g4-browser` | 180 / 7 | 1 | 4 | 0 |
| `codex/issues-g4-native-counts` | 181 / 10 | 7 | 5 | 1 |
| `codex/issues-g6-initial` | 210 / 4 | 6 | 7 | 0 |
| `codex/main-dirty-archive-20260918` | 273 / 1 | 66 | 17 | 0 |
| `codex/phase1-admission` | 448 / 8 | 3 | 20 | 0 |
| `codex/phase1-core` | 448 / 15 | 25 | 41 | 0 |
| `codex/phase1-model-spec` | 448 / 6 | 2 | 4 | 1 |
| `codex/ui-session-race` | 438 / 1 | 0 | 1 | 0 |
| `codex/warm-runtime-workerd` | 312 / 5 | 1 | 1 | 0 |

## Decisions

- `g5-bounded-unsettled`: copied its 14 dirty candidate files into the isolated delivery tree; original checkout unchanged. Local review and tests do not authorize deployment.
- `g5-runtime-observation`: all 9 paths are identical to main; no merge required.
- authority / fixture / B2: no branch-exclusive paths missing from main. Existing implementations and later changes are retained; different blobs or non-equivalent patches are not evidence of missing functionality. Focused authority/Workerd tests cover retained behavior; do not merge stale branches wholesale.
- `issue-73-luna-agents-experiment`: imported 48 experiment, test and sanitized evidence files from 6b0cdb1. Added only fflate 0.8.3 to current dependency declarations; no old package manifest replacement.
- `g5-upstream-http-evidence`: conclusions retained in g5-historical-evidence-disposition-20260919.md; the original untracked investigation files stay in that worktree.
- G4/G6/phase1/UI/warm branches: historical references. Initial-copy, preview, UI and runtime tests on the current candidate are the behavioral checks, not commit counts. No branch-wide merge is queued.
- `main-dirty-archive-20260918`: preservation only; no import or deletion.

This inventory does not prove semantic equivalence of every differing old file. Missing behavior found by review or acceptance requires a scoped patch on current main.
