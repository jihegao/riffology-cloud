# Issue 83 preview UI delivery

The Preview tab uses “模型预览” for the browser model. The cloud interaction
preview region is hidden while paused, including before initialization and after
leaving a project. An enabled cloud preview is explicitly named “云端交互预览”.
The backend, stored open intents, permissions and historical results remain intact.

The generic version warning has been removed. Browser previews retain their
saved source identity and show the current saved revision only when it differs
from the loaded preview revision.

Validation (2026-09-19, Asia/Shanghai):

- 38 preview-panel, browser-preview-panel and workspace-layout tests passed.
- UI syntax checks and `git diff --check` passed.
- Deployed Worker `0ca0acc2-fed7-43fe-9fdf-dd19d1e9b9c5` at 100% traffic.
- Source manifest: `5fc122b57ed6307eb584f170c7f082f950f465934666468248f6c4e8e47589bf`.
- Independent version readback preserved every binding except the intended source
  manifest variable update; static web assets changed as intended.
- Authenticated aa workspace: “模型预览” visible, old cloud preview card absent,
  saved revision and independent preview link retained.
- Actual local execution completed and rendered 18 vehicles. A single playback
  step changed mean_speed from 14.877 to 11.077 and congestion_index from 0.07
  to 0.308, while retaining the same saved revision/package identity.
- The user had already confirmed that the independent preview link opens. This
  deployment retained that exact link; this verification did not open another
  independent tab or submit a cloud experiment.

Local deployment manifests, test logs and independent readbacks are retained in
`.local/issue83-20260919/`. Local execution is not cloud Experiment/Evidence
verification. Broader Queue/Mesa acceptance in issue 78 is outside this change.

Repository closeout, 2026-09-19: `git ls-remote --heads origin main` and local
`main` both resolve to `727c40f11a5b5e2fd2eebace05e4bd3971955432`. The issue
comment's “尚未推送” statement is superseded. This read-only source check does not
repeat deployment verification or satisfy the remaining online interaction matrix.
See [current release readiness](release-readiness.md) for the candidate and gaps.
