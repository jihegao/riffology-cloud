# Project native epoch foundation

This native layer is not runtime-pool orchestration. The existing cold path
remains available when no binding journal exists and no binding epoch is sent.
No deployment, lease gate, TypeScript adapter or runtime default is changed.
Existing Project Dockerfiles already copy these Python modules; no new image
instruction is needed.

All operations share the existing root:root 0700 effects directory and spawn
lock. Warm state is an atomic fsynced root-only `binding.json`; malformed state
never falls back to cold behavior. The root caller supplies
`RIFFOLOGY_BINDING_EPOCH` in the platform command environment, not in a Project
request or user environment. The child environment does not inherit it.

## CLI contract

`python3 /opt/riffology/process_quiescence.py activate --epoch TOKEN` accepts a
safe opaque token (1–128 ASCII alphanumeric, underscore or hyphen). It requires
native pidfd support and a virgin or sealed domain with two empty UID scans.
A repeated current epoch returns its actual `active` or `sealed` status and
never unseals. Old epochs are never reactivated; after 1024 bindings use a fresh
container. Response: `{schemaVersion:1,bindingEpoch:TOKEN,status}`.

`RIFFOLOGY_BINDING_EPOCH=TOKEN python3 /opt/riffology/process_quiescence.py seal`
checks current epoch, persists its seal before signals, kills the entire
nonroot Project UID 10001 domain and returns the existing proof plus epoch:
`{schemaVersion:1,sealed:true,quiescent:true,projectUid:10001,bindingEpoch:TOKEN}`.
A warm missing/wrong epoch or absent journal is denied. Cold seal keeps the
existing four-field proof and its existing compatibility fallback. A seal error
is never an empty-domain proof and cannot authorize handoff.

`effect_wrapper.py EFFECT_ID` validates the epoch under that lock **before
reading/consuming** the root-staged control. Its child drops to Project UID with
the existing irreversible network/seccomp fence, signals readiness, and waits
for a pipe gate while root still holds the admission lock. Root death before
this handshake closes the gate; a delayed old child cannot later execute under
a new binding. Detached children remain in the UID domain. A late wrapper must
recheck epoch and cannot consume a new control. The existing effect ledger and
identity checks remain the TypeScript authority for allowed requests; this
layer does not infer ACL from the epoch.

`platform_workspace_archive.py restore TOKEN` requires the active epoch;
`freeze TOKEN` requires the same sealed epoch, an independently quiet UID domain
and that epoch's restore/adopt token. Each binding admits one archive token.
Warm freeze records its exact output token/bytes/SHA256 durably in the journal.
All warm archive operations and checks execute under the same spawn lock.
Cold restore/freeze retain their existing output shape and root restore-marker
requirement.

`platform_workspace_archive.py adopt NEW_TOKEN PRIOR_TOKEN` additionally takes
root environment `RIFFOLOGY_EXPECTED_FILES_SHA256`. The prior token must be the
**immediately preceding binding's** frozen proof; arbitrary older archives are
not accepted. It verifies the root restore marker, frozen output bytes/hash,
and a fresh canonical hash of the current workspace. On exact equality it
creates a root restore marker for the new token and binds it to this epoch.
The result has the existing restore shape:
`{ok:true,operation:'restore',bytes,sha256}`. Retries verify the same proof and
marker. Wrong digest, live processes, workspace drift, missing/tampered proof,
or another token are denied. Adoption preserves existing workspace inodes; it
avoids unpacking and rewriting, **not** the read/hash cost. The verification tar
and historical archives remain root-only. The future orchestrator must bound
retention/capacity or replace the container; this patch does not clean them.

## Evidence and limits (2026-09-14)

`node scripts/m2/check-project-epoch-local.mjs` ran 9 real native arm64 Linux
checks with actual effect wrapper, file service, network fence and archive
modules in cached `python:3.11-slim-bookworm`, network disabled, no pulls. It
covers cold behavior, detached processes, wrapper death before drop, old queued
requests across rebind, absent/corrupt state, exact adopt/replay/inode retention,
wrong digest, workspace drift and rejection of arbitrary historical proofs.
`node --test tests/m2/workspace-archive.test.mjs` passed all 4 archive regressions.

The cached Project AMD64 image's existing quiescence script fails its first
orphan scenario on this ARM host; the unchanged f8fc7bb baseline fails the same
scenario. No fallback was relaxed to make this pass. Warm activation also
requires native pidfd, unsupported under the cached AMD64 emulation. Actual
Cloudflare image/kernel compatibility and full lease/adaptor integration remain
unverified. Unsupported or unknown operations require quarantine/destruction and
cold fallback; these native tests alone do not authorize enabling reuse.
