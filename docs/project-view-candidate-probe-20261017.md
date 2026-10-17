# Candidate image offline probe execution contract

This Goal already authorizes bounded offline validation. The user has also explicitly approved transferring the unchanged original 4,061,701-byte archive, SHA256 `b42440856d0f73b3a16d45dbc48c2d5abe3802adf901395a66b7e419d1e33cee`, to AMD128 and repairing its existing proxy. That archive does not contain this probe or the new preflight inputs. Transferring the new private v2 payload, containing the 13-file source closure and updated image context, requires additional permission for its [exact manifest](../evidence/releases/project-view-image-inputs-20261017/candidate-v2-payload-manifest.json) and destination; the original archive approval does not cover those new bytes. No fresh approval for the already authorized offline validation is required. Cloudflare deployment and user/provider execution retain their separate scope.

The probe imports the current `PROJECT_VIEW_BROWSER_PROGRAM`, `createProjectViewRuntimePipe`, package verifier and readonly MessageChannel broker. It checks a fixed synthetic package, real browser installation and broker file reads, five bounded input commands, changed PNG bytes and original-container release. Its Node contract tests inject transport/process observations; those tests do not demonstrate an actual browser or Docker execution. A successful real attempt is still local/unverified, not Cloudflare target, authenticated user, canonical Revision or production acceptance.

## Required inputs

- A previously built, explicit local derived image ID, exactly `sha256:` plus 64 lowercase hex digits. No tag, registry reference, image pull or automatic rebuild is accepted. Preserve separate frozen build/provenance evidence connecting this ID to the reviewed Dockerfile, pinned base digest and vendor inputs.
- The SHA256 of the exact raw `context-receipt.json` bytes copied to `/opt/viewer/context-receipt.json` in that derived image. The program independently hashes all 176 pinned Playwright package files and validates uid/gid, capabilities and Chromium compatibility before accepting any project init. This compatibility report is not OCI attestation.
- An explicitly selected Linux/amd64 Docker host and a readable local Docker socket at `unix:///var/run/docker.sock`, with CPU IDs `0,1` available. Host runtime/sandbox support must permit the fixed seccomp profile and Chromium user namespaces. Unsupported policy is a blocked attempt; do not relax flags or retry with another sandbox.
- Node.js satisfying repository `engines` (at least 22.19.0), the exact frozen source tree below and a fresh output directory whose parent already exists. The probe uses Node built-ins; it does not install or execute a host Playwright package.

Inspect requires image `Os=linux`, `Architecture=amd64`, `Config.User=10001:10001`, `Config.WorkingDir=/opt/viewer`, exactly one bounded absolute PATH and no image HOME override. Only the selected PATH and nonsecret identity/config fields enter the receipt. Docker may inject HOME into the keepalive process; both actual candidate processes are started by the exact argv `/usr/bin/env -i PATH=<validated image PATH> node ...`, without a shell. Thus preflight and browser see only PATH, matching the native runtime `env:{}` contract; neither HOME nor PLAYWRIGHT_BROWSERS_PATH is inherited.

## One bounded attempt

Under the existing Goal authorization for offline validation, verify the exact inputs and replace the three uppercase example values with the selected local image ID, raw receipt hash and new absolute output directory. If execution requires transferring the new private v2 payload to AMD128, obtain only that specific additional transfer permission and verify the received manifest before using it:

```sh
node scripts/m3/project-view-candidate-probe.mjs sha256:DERIVED_IMAGE_ID_64_HEX RAW_CONTEXT_RECEIPT_SHA256_64_HEX /ABSOLUTE/NEW_ATTEMPT_DIRECTORY
```

The example placeholders are deliberately invalid and cannot execute unchanged. The script has no build/pull/retry/fallback option. It reserves one new evidence directory and random UUID before effects, then:

1. Inspects the local derived image. Starts a fixed keepalive with `--pull=never`, `--network=none`, readonly root, uid/gid `10001:10001`, cwd `/opt/viewer`, all capabilities dropped, no new privileges, pinned seccomp, 768 MiB memory, 1 vCPU, CPU set `0,1`, 128 PIDs, 128 MiB shm and a 256 MiB `/tmp` tmpfs. No ports, bind mounts, devices or privileged mode are requested.
2. Resolves exactly one container bearing this operation's new label, verifies immutable ID/name/image/both operation labels and effective sandbox/resource configuration, and records that original ID before any exec.
3. Runs the fixed shared preflight by original ID with PATH-only environment. Stdin is disabled; its sole argument is the expected raw receipt hash. Requires bounded report, EOF and exit zero within at most 10 seconds, before sending any project content.
4. Runs the fixed native browser program by original ID with the same PATH-only environment. Sends the synthetic package through the actual runtime pipe. The host readonly broker provides only declared fixture files through a real MessageChannel. Waits for installation and page-generated post-render read markers; sends button click, focus click, text insertion, Enter and fractional wheel commands. Writes before/after PNGs and requires different byte digests. PNG validation remains bounded header/dimensions plus changed bytes, not independent pixel/chunk/CRC validation.
5. Closes broker/ports/pipe, then destroys only the verified original immutable container ID. A lost remove ACK is resolved by both an empty exact-operation label listing and an explicit Docker NotFound naming that exact original ID. Daemon errors, ambiguous output or a label query alone cannot prove release. Process/CLI exit is recorded separately and never substitutes for container absence.

Each Docker control command has a 15-second transport timeout and 1 MiB output cap. Creation observation is capped at 15 seconds. Preflight and browser observations share one 60-second deadline after container verification; preflight is additionally capped at 10 seconds. Pipe close is capped at 5 seconds, and each of at most three Docker CLIs gets at most 5 seconds exit observation followed by 1 second after SIGTERM before SIGKILL. These are stage bounds, not a promise that the entire attempt takes 60 seconds. SIGINT/SIGTERM block the result and enter original-ID cleanup; supervisor/host failure can still leave cleanup pending.

Docker fixture resources (0.75 GiB / 1 vCPU) are not equivalent to the pending Cloudflare basic target (1 GiB / 0.25 vCPU). This attempt cannot validate target capacity, lifecycle alarms, native exec environment delivery or target release; those require the separately authorized Cloudflare target acceptance.

## Failure and original-identity cleanup

Every attempted stage retains bounded raw stdout (8 MiB) and stderr (1 MiB), byte counts, hashes, discarded-byte counts and CLI exit observations, including malformed JSON/preflight failure. Any discarded output blocks acceptance. `candidate-evidence.json` records the exact program/profile/image/context identities, synthetic scope and uncovered claims. Failure remains blocked; no automatic replacement container or new operation is started. A container create without a verified ID remains unresolved even when its label query is empty.

If an original attempt has pending cleanup, use only its existing directory and its recorded UUID after reviewing that record:

```sh
node scripts/m3/project-view-candidate-probe.mjs --cleanup /ABSOLUTE/ORIGINAL_ATTEMPT_DIRECTORY --operation ORIGINAL_UUID
```

Cleanup reuses the recorded image/name/labels/immutable ID, preserves the prior record hash and never upgrades the experiment to passed. It cannot delete by a caller-selected name or shared prefix. Unknown inspect/list/remove state remains blocked. Do not create a new operation to bypass it.

This minimal probe does not execute the older nine-egress collector experiment. A network-none inspect is not collector evidence. The existing collector probe requires a separate reviewed execution contract with positive controls, failed-control receipts and original-ID cleanup; no nine-egress or inner-sandbox result may be inferred from this probe. Its fixed native browser still requests `chromiumSandbox:true`, and the launcher never adds `--no-sandbox`.

## New payload file closure

Preserve these repository-relative paths and exact frozen bytes (including the root `package.json` with `type:module`) in any proposed new payload. No source directory or omitted dependency may be replaced with the previous four-script archive:

```text
package.json
scripts/m3/project-view-candidate-probe.mjs
scripts/m3/project-view-offline-prototype.mjs
scripts/m3/offline-view/chromium-userns-seccomp.json
services/project-views/runtime-preflight.mjs
services/project-views/runtime-pipe.mjs
services/project-views/isolated-browser.mjs
services/project-views/frame.mjs
services/browser-preview/runtime/sha256.mjs
services/web/project-views.js
services/web/project-view-remote.js
services/web/i18n.js
services/web/i18n-bindings.js
```

Also preserve the reviewed derived image build context: updated `Dockerfile`, exact raw `context-receipt.json`, both complete frozen vendor directories and build/input receipts. The image must already exist locally; this execution script never builds it. Keep `tests/m3/project-view-candidate-probe.test.mjs` and this execution contract with the review/evidence sources. The final payload manifest must enumerate actual bytes/hashes after all source changes settle; this document does not freeze a new archive or authorize moving it.

The import closure above uses no third-party host modules. `runtime-pipe.mjs` imports `frame.mjs`, which imports the SHA256 implementation; omitting either would prevent execution before Docker starts. Frontend package/broker imports also require the listed i18n and remote modules even though this probe does not create the product panel.
