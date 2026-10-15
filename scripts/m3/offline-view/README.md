# Offline Chromium preparation contract

This directory prepares the approved local synthetic arbitrary-JavaScript experiment. It does not enable a production page route, establish a production browser boundary, or run Docker. The existing launcher and its original-operation cleanup remain in [project-view-offline-prototype.mjs](../project-view-offline-prototype.mjs).

## Per-container seccomp candidate

`chromium-userns-seccomp.json` is the complete [Moby seccomp/v0.2.4 baseline at commit 245180c](https://github.com/moby/profiles/blob/245180c51918481c0525424b3ee025d2b435d46c/seccomp/default.json), with exactly two appended allow rules. The first permits `clone`, `setns`, and `unshare`, following [Playwright v1.63.0's namespace rule](https://github.com/microsoft/playwright/blob/v1.63.0/utils/docker/seccomp_profile.json) and its [Docker guidance](https://playwright.dev/docs/docker). The second permits `chroot` for this project's `cap-drop=ALL` experiment. The original baseline is Apache-2.0; its license is included as `MOBY-LICENSE`. Source and byte hashes are in `seccomp-provenance.json`.

The candidate changes the baseline's namespace and `chroot` restrictions. It retains default `EPERM`, `clone3`'s non-SYS_ADMIN `ENOSYS` fallback, the other capability conditions, and denial of `io_uring`. It does not copy Playwright's older complete profile, which would change unrelated rules. These are the documented compatibility deltas to this baseline; no syscall trace has established the minimum rule set for Chromium 1243 on AMD128. A custom profile replaces Docker's daemon-selected seccomp profile rather than adding a second filter: the baseline version must therefore be part of the review and evidence.

The extra `chroot` rule goes beyond Playwright's three-call example. In [Moby's loader](https://github.com/moby/profiles/blob/245180c51918481c0525424b3ee025d2b435d46c/seccomp/seccomp_linux.go#L130), `includes.caps` is resolved against the container's initial bounding set when loading the filter. `cap-drop=ALL` therefore omits its original `CAP_SYS_CHROOT`-conditioned rule. Chromium 153.0.8010.12 [enters a new user namespace and then removes filesystem access](https://github.com/chromium/chromium/blob/153.0.8010.12/sandbox/policy/linux/sandbox_linux.cc#L572), using [`chroot("/proc/self/fdinfo/")`](https://github.com/chromium/chromium/blob/153.0.8010.12/sandbox/linux/services/credentials.cc#L48). The new filter permits the call to reach Linux's existing [current-user-namespace capability and LSM checks](https://github.com/torvalds/linux/blob/v6.8/fs/open.c#L563). It does not grant an outer capability. Ordinary seccomp cannot filter a pathname pointer's string contents; this permits the `chroot` syscall generally, not just this one path. `chroot` alone is not a containment boundary.

Apply the reviewed file only to the individual experiment container, alongside all existing launcher limits:

```text
--security-opt seccomp=/absolute/path/chromium-userns-seccomp.json
--security-opt=no-new-privileges
--user 10001:10001 --cap-drop=ALL --network=none --read-only
```

The profile's expected SHA-256 is `4cdcdc07d9676737fa78222a8fffeda5cd0ebd2b209c82fafd2077d051d30ae2`. Resolve and hash the local file before run, retain the reviewed bytes unchanged for that operation, and record the path/hash plus Docker/Engine, runc, libseccomp, kernel and architecture versions. The existing launcher does not yet expose a seccomp option; a local integration must pass the explicit profile and preserve its pending evidence, run timeout and exact-ID cleanup. There is no automatic profile fallback.

Keep the Unix Docker socket on the trusted supervisor side. Do not mount it, the profile, host files, or credentials into the container. Do not change daemon defaults, AppArmor policy, sysctls or host user-namespace settings. Do not use `seccomp=unconfined`, `privileged`, `cap-add=SYS_ADMIN`/`cap-add=SYS_CHROOT`, host networking/IPC/PID namespaces, or `--no-sandbox`. Docker grants no capabilities in the outer namespace; Chromium can temporarily obtain capabilities inside its new child user namespace, as its sandbox implementation requires. Do not describe the entire browser process tree as always having zero capabilities. A missing/unsupported syscall name, blocked user namespace, incompatible kernel/LSM, or Chromium launch failure stays blocked. Allowing namespace syscalls still exposes that kernel surface; it does not prove immunity to host/kernel exploits. [Docker's seccomp documentation](https://docs.docker.com/engine/security/seccomp/) describes this allowlist model.

## Offline image preparation plan

Use a fresh, private staging directory, not the repository root or the entire Playwright cache. The repository's deny-by-default `.dockerignore` is intentional. The experiment image needs only these reviewed inputs:

- The complete local Node base image ID, not the short `9b76ab9ee7a4` identifier or a mutable remote tag. Record its Linux/amd64 and OS/ABI identity. The base must already be present; build with `--pull=false --network=none` and no package-manager/network installation.
- The installed `playwright` and `playwright-core` packages, both exactly `1.63.0`, including their package manifests and `playwright-core/browsers.json`. The package declares Chromium revision `1243` / browser `153.0.8010.12`. Do not copy all `node_modules`, npm configuration, project files, browser profiles or credentials.
- A complete reviewed Linux/amd64 `chrome-linux64` directory from Chromium 1243, with executable bits, resources and required adjacent data files. Set the experimental launcher's explicit `executablePath` to `/opt/chrome/chrome`; do not silently select another cache revision or browser. This is a preparation plan for the parent's separate local integration; the current checked-in launcher still uses Playwright's standard executable lookup.
- The actual dependency closure for that executable and any child executables used, including the dynamic loader and required shared libraries. Record source OS/ABI and the exact paths/hashes, preserve necessary symlinks without allowing traversal outside the reviewed context, and inspect the final image for unresolved dependencies. Do not replace arbitrary base libraries or copy host `/usr/lib` wholesale. Cached libraries from a different distro/ABI are not presumed compatible. Any additional fonts/configuration must be enumerated too.

Store a content manifest of the allowlisted build inputs and resulting full local image ID. Keep the build context free of user content and secrets; a `COPY .` context is unsuitable. Runtime `/opt/viewer` must resolve `import('playwright')`, and UID/GID `10001:10001` must read and execute the image inputs. Root may prepare the image filesystem during an offline build, but the experiment always runs as the fixed non-root UID with the original read-only rootfs, private bounded `/tmp` and `/dev/shm`, no mounts, no ports, no capabilities, and CPU/memory/PID limits. The current private shared-memory limit may fail; failure is not permission to adopt Playwright's host-IPC recommendation.

A local `ldd` closure makes an experimental image reproducible only when its inputs are recorded; it does not establish compatibility, redistribution suitability, image hardening, or a production supply chain. [Playwright's Docker documentation](https://playwright.dev/docs/docker) requires browser/package version alignment and warns its own image is intended for testing/development. A local copied-browser image has no stronger assurance.

## Evidence still required

Run policy tests with:

```bash
node --test tests/m3/offline-view-seccomp.test.mjs tests/m3/project-view-offline-prototype.test.mjs
```

These are static and injected-runner tests. They do not execute Docker, build an image, launch Chromium, or validate a host policy. Real local evidence must separately show a non-root sandboxed browser launch, synthetic click/frame behavior, no external route or native socket connectivity, timeout/termination and confirmed original-container cleanup. `chromiumSandbox: true` is only a requested launch option; `Seccomp: 2` alone could be Docker's outer filter. Chromium sandbox diagnostics and renderer namespace/filter observations are needed before claiming the browser's inner sandbox activated. [Docker network none](https://docs.docker.com/engine/network/drivers/none/) supplies only loopback; keep the existing kernel-connect check too.

The preparation branch ran the command above on 2026-10-15: 13 tests passed, exit 0; `git diff --check` also exited 0. No Docker or Chromium execution was performed by these tests or this preparation branch. Parent-run AMD128 observations and image identities must be recorded in the separate actual experiment evidence, rather than inferred from these static checks.

Actual arbitrary-JS containment, navigation canaries, cross-operation separation, immutable real packages, ownership/revocation, safe complete image decoding and user UI forwarding remain separate acceptance work. Synthetic stdout is untrusted; current PNG checks cover only the header, and `productionEligible`/`userUiEligible` remain false. No result from this preparation changes the production gate.
