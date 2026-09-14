# TrustedPi native epoch primitive

This is a native foundation, **not an enabled runtime reuse path**. The existing
TypeScript cold path still starts the host as root. No deployment or runtime gate
is changed here. The image retains the root Sandbox API service, adds account
`trustedpi` (UID/GID 10002), and gives that account private writable `pi` and
`turns` directories. Platform code, SDK and release modules remain root-owned.

Root invokes `/opt/riffology/runtime_supervisor.py` with:

- `activate --epoch TOKEN`: virgin or previously sealed, independently empty UID
  domain only. Repeated current activation returns its current state; it never
  removes a seal. Used epochs cannot be activated again. After 1024 epochs a
  fresh container is required; tombstones are never expired.
- `spawn --epoch TOKEN -- /usr/local/bin/node /opt/riffology/trusted-pi/trusted-pi-turn-host.mjs HOST_TOKEN`:
  fixed executable/program and 52-hex host token only. Exactly one launch intent
  per epoch is persisted before fork. A retry, failed launch or lost response does
  not launch again. Root wrapper waits for child and forwards TERM/INT by pidfd.
- `seal --epoch TOKEN`: reject absent/mismatched state; persist sealed status
  before killing the entire UID domain. Only two empty live-process scans under
  the common admission lock produce
  `{"schemaVersion":1,"bindingEpoch":"TOKEN","status":"quiescent","remaining":0}`.
  Zombies cannot execute and are not counted. A stale seal cannot kill the new
  binding. Errors produce exit 4 and no JSON proof.

`/var/lib/riffology/runtime-control` is root:root 0700. Lock and atomic journal
are root-only, nofollow, fsynced files. The child drops supplemental groups,
UID/GID and enables `no_new_privs` before the root opens its execution gate,
while holding the same lock as seal. A delayed child whose wrapper dies cannot
pass the pipe gate. A delayed wrapper must recheck the current epoch. Detached
children share the killable UID domain; root processes are outside it. Native
pidfd support is required even for empty-domain activation/seal receipts.

The `turns` directory is application-owned because the existing host atomically
writes results and checkpoints there. It contains **no epoch authority**. The
future root orchestration must clean prior Session files and stage validated new
control/input files only after sealing and quiescence, then activate the next
binding. It must not accept old native process receipts, parent exits or errors
as whole-domain proof. Unsupported/unknown native operations require quarantine
and container destruction/cold fallback, never reuse. This patch does not yet
implement that orchestration.

## Local validation (2026-09-14)

`node scripts/m2/check-trusted-pi-supervisor-local.mjs` uses cached images only,
`--pull=never --network=none`, and never calls providers/tools:

1. Native arm64 `python:3.11-slim-bookworm`: 10 actual Linux process tests cover
   pidfd, independent UID, detached double-fork grandchildren, stale epoch/seal,
   duplicate starts, concurrent spawn/seal, root wrapper death before drop
   handshake, malformed/symlink state, nonroot access, virgin nonempty domain,
   and TERM forwarding. The fixed program is a Python fixture at the prescribed
   argv paths; this portion is not a Node/SDK test.
2. Cached `riffology-trusted-pi-vertical:local` amd64 image: current actual host
   module and cached SDK imports execute with a fake session under root and UID
   10002. Both read root-staged 0644 control and persist 0600 result/checkpoint.
   This verifies host file access, not a paid model turn or native reuse.

The amd64 image under this arm64 machine's emulation returns ENOSYS for pidfd;
production supervisor correctly fails closed there. All cached TrustedPi images
were amd64. Actual target image/kernel integration remains an acceptance gate;
these local successes do not establish that Cloudflare native execution supports
or has enabled this path. Neither production Dockerfile was rebuilt/deployed.


## Checkpoint-confirmed pruning

After the coordinator has durably committed the current Session checkpoint,
root may call `prune --epoch EPOCH --token CURRENT_HOST_TOKEN`. This requires
current sealed epoch, exact persisted spawn token and two empty UID scans under
the same admission lock. It removes only other 52-hex token files with platform
suffixes `control.json`, `input-session.json`, `result.json`,
`output-session.json` (including their numeric PID temporary suffixes). Current
Turn files remain available until the next binding is checkpointed. Unknown
filenames are retained; symlink/hardlink/non-regular candidates fail closed.
The epoch journal and tombstones are untouched. Response:
`{schemaVersion:1,bindingEpoch:EPOCH,status:'pruned',removed:COUNT}`; retry is safe
and may report zero. The native process cannot itself prove remote checkpoint
commit: the root coordinator must order that commit before this call.

Native coverage now totals 12 tests, adding four-epoch file-count bounds,
active/stale/wrong-token rejection, replay and symlink-target preservation.
This pruning does not cover Sandbox SDK process metadata/logs or other image
cache directories. Their capacity policy and supported SDK cleanup remain
separate orchestration requirements.
