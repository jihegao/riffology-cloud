# M0 Preview access probe (G0-T07)

This fixed synthetic probe keeps **G0-T07 unevaluated**. Product Browser remains closed pending the cloud gate. The browser principal is a server-owned fixture (`fixture-alpha` / `fixture-bravo`), not the M1 production login. Local browser results must come from a recorded driver run; implementation and Node tests alone are not browser evidence.

The existing `PREVIEW` binding contains one browser-authority DO plus one coordinator per run/tenant. A separate `PreviewSandbox` namespace runs only `runtime.ts`'s fixed Python HTTP service at `/tmp/m0-preview.py`, port 8080. The VM has no platform credentials, no internet, no allowed hosts, and an outbound deny handler. No request accepts source, commands, an execution path, URL target or port. The Worker injects its random generation into a non-secret `fixture_instance_marker`, returned in HTTP/WS state for routing diagnostics. **Project stdout, files, markers and response bodies never authorize a browser.**

## Browser authority and trust boundary

All routes require `ENVIRONMENT=staging`, `PROTOCOL_VERSION=m0-v1`, separate management/signing secrets, and configured HTTPS origins. Control cannot be a Preview subdomain. `M0_PREVIEW_ORIGIN` is a hostname base, not a public project service. Each server-generated generation gets its own origin, for example `https://p-<32hex>.preview.m0.test:8791`; there is no generic shared-origin project path fallback.

The browser flow is:

1. The operator's management Bearer creates a one-use, 30-second enrollment for a fixed tenant. Consuming it establishes an opaque server-issued `__Host-m0_principal` platform cookie and a ten-minute authoritative session. Principal comes from the server's enrollment record. Request bodies, arbitrary headers, URL principal claims and project content cannot select it. Enrollment is an operator-controlled synthetic login fixture; handing its code to the intended context is the fixture provisioning step.
2. A logged-in control page POSTs the fixed ticket endpoint with an empty body and the **exact control Origin**. The DO checks the real platform session's tenant and issues a 30-second ticket bound to that exact session ID, run, tenant, Preview and generation. Two logins for `fixture-alpha` are distinct sessions. A fixture session may access multiple runs belonging to its fixed tenant; each run/tenant owns one Preview.
3. The ticket URL starts on the derived Preview host. It establishes a challenge with a separate random nonce in a signed HttpOnly cookie. The nonce never appears in a URL. The browser redirects to control, where the current platform session must equal the ticket's owner. A wrong subject is rejected without consuming the owner's ticket.
4. Successful control authorization atomically advances that challenge and issues a one-use code. It does not consume the ticket yet. Preview redemption requires that code **and the original challenge cookie**. The DO atomically consumes the ticket/code/challenge only after validating the nonce and creates an access record with a maximum **20-second wall-clock lifetime**, bounded by the Preview and platform session lifetimes. Borrowing the owner browser's cookie for an authorize navigation cannot burn the original ticket when that browser lacks the challenge nonce. A 303 clears the URL query and clears the challenge cookie.
5. Every document, JS, API and WS request checks the access record, its live platform session and the current coordinator generation. Logout revokes the platform session first, persists a per-session coordinator fence before closing that session's WS through RPC, and denies existing access records. Late access RPC snapshots cannot override that fence; content/socket registration and message forwarding recheck synchronously. An old generation alarm ignores a new starting record. A one-second WS authority recheck also fails closed if the close notification is lost. Preview revoke and expiry close WS and destroy the Sandbox. There is no automatic ticket replay or refresh.

Enrollment, ticket, challenge, code and access state live in Worker-owned SQLite DO storage. `browserAction()` has no awaits; validation and all one-use mutations run in the same `transactionSync`. Concurrent double authorization/redemption has one success. Challenges share one host cookie: overlapping same-host handshakes may fail closed and require a fresh ticket; this fixture does not implement production multi-tab login UX.

All three cookies use `__Host-`, `Path=/`, `Secure`, `HttpOnly`, `SameSite=Strict` and no Domain. Their opaque values also have HMAC signatures bound to their cookie role. Control and each Preview therefore have separate browser cookie jars. The access cookie remains a session credential: this is copied-URL protection and server-session binding, not a claim that a stolen authenticated cookie cannot be replayed. The driver never copies cookies between browser contexts to manufacture login-binding evidence. Its separate raw HTTPS protocol/concurrency checks read credentials only in memory from the issuing context.

SameSite is not the control CSRF defense: project subdomains are same-site and can cause cookies to be sent to control. Every control write needs the exact control Origin, a validated server-owned session and an empty body. The fixed Preview CSP permits `connect-src 'self' <control-origin>` specifically so the driver can send and measure that authenticated cross-origin attack; control returns 403 and no CORS permission. Other Preview origins are outside connect-src.

The control fixture embeds Preview with `sandbox="allow-scripts allow-same-origin"`. Preview response CSP repeats that sandbox and permits only the control frame ancestor. Different origins plus `Origin-Agent-Cluster: ?1` prevent project DOM/document.domain access to control or sibling Previews; sandbox disallows top navigation/popups. Project Set-Cookie, CORS and security headers are discarded. A project cannot inject a Domain cookie that overwrites a `__Host-` credential.

The proxy reconstructs a fixed upstream request. All cookies, Authorization, Referer, Origin, forwarded host/port and SDK control headers are removed. Browsing rejects platform Bearer headers entirely. GET paths are allowlisted; arbitrary queries, methods, URLs and raw port routes are rejected. WS requires its exact Preview Origin. Safe fixed relative redirects stay under the same scope; external, control, ambiguous and query-bearing redirects fail. HTTP uses SDK 0.12.9 `containerFetch`; WS uses its `wsConnect` fetch transport behind the same authority. No exposed port, public preview URL, tunnel or `proxyToSandbox` exists.

## Interfaces

All management calls use `Authorization: Bearer <M0_PROBE_TOKEN>` on the control origin, with no query or body. The existing bounded run IDs and fixed alpha/bravo tenants are validated.

| Method | Path | Result |
|---|---|---|
| POST | `/m0/preview/<run>/<tenant>/start` | Starts fixed service; returns grant and derived origin, **no browser ticket** |
| GET | `/m0/preview/<run>/<tenant>/status` | Coordinator authority state, no credential |
| GET | `/m0/preview/<run>/<tenant>/diagnostics` | Active generation's SDK exposed-port count/numbers; capability URLs redacted inside DO; configured control redirect origin |
| POST | `/m0/preview/<run>/<tenant>/enroll` | One-use synthetic fixture enrollment URL |
| POST | `/m0/preview/<run>/<tenant>/revoke` or `cleanup` | Denies access, closes WS and destroys Sandbox |
| GET | `/m0/browser/enroll?code=...` | Synthetic fixture login, then clean session URL |
| GET | `/m0/browser/session` | Current synthetic principal/tenant, no cookie value |
| POST | `/m0/browser/<run>/<tenant>/ticket` | Current session's one-use Preview URL; exact Origin required |
| POST | `/m0/browser/logout` | Revokes current platform session and existing Preview access |
| GET | `/m0/browser/frame/<run>/<tenant>` | Trusted control page with isolated Preview iframe |

`/auth/start?ticket=...` and `/auth/redeem?code=...` exist only on derived Preview hosts. Documents and fixed resources use `/p/<run>/<tenant>/fixture-<tenant>-preview/<generation>/`, followed by `app.js`, `api/state`, `api/headers`, `ws`, `redirect-safe`, `redirect-external`, `redirect-control`, or `set-cookie`. Raw Preview URL remains null.

## Local verification

Default tests start no server, browser, Docker or Wrangler:

```sh
node --test spikes/m0-preview/*.test.ts
npm run typecheck
node --check scripts/m0/preview-browser.mjs
```

Fifteen pure Node tests cover configuration denial, credential role/tampering, authoritative principal/session binding, copied ticket rejection without consumption, atomic one-use transitions, CSRF, scope/origin/generation binding, logout/expiry, fixed proxy routes/headers, redirects, frame policy, rejected stream cancellation and the restricted diagnostic endpoint/configuration. `protocol.test.ts` preserves the real Python HTTP/WS regression behind `M0_PREVIEW_PROTOCOL=1`; run it separately with loopback port 8080 free. Its result proves protocol behavior only.

The caller starts **one** local Workerd instance with the dedicated project-local TLS directory. That directory contains `cert.pem`, `key.pem`, `vars.env` with two separate temporary secrets, and `metadata.json` with fixed origins and the certificate SPKI SHA-256. SANs must cover `control.m0.test`, `preview.m0.test` and `*.preview.m0.test`. Never log enrollment, ticket, challenge, code URLs or cookies.

Create a fresh fixture from the repository root before starting Wrangler:

```sh
node scripts/m0/preview-tls.mjs
```

The helper creates an exclusive `.local/m0-browser-tls-<timestamp>-<random>/` directory with a two-day self-signed certificate, the required SANs, two independent random secrets in `vars.env`, and public `metadata.json` containing the fixed origins and SPKI digest. It prints only the TLS directory and metadata path. It does not change system trust or hosts, and it does not start a browser, service, or network operation. Pass the printed directory to the existing TLS Wrangler command and then `npm run m0:preview:browser -- <TLS-directory>`; keep the Workerd/Docker integration serial.

```sh
M0_PREVIEW_TLS_DIR="$PWD/.local/m0-browser-tls-<unique-id>"
DOCKER_HOST="unix://$HOME/.colima/riffology-m0/docker.sock" \
DOCKER_CONFIG="$PWD/.local/docker" \
./node_modules/.bin/wrangler dev \
  --config infra/wrangler.m0-preview.jsonc --env staging --local \
  --env-file "$M0_PREVIEW_TLS_DIR/vars.env" \
  --ip 127.0.0.1 --port 8791 --local-protocol https \
  --https-key-path "$M0_PREVIEW_TLS_DIR/key.pem" \
  --https-cert-path "$M0_PREVIEW_TLS_DIR/cert.pem" \
  --var M0_CONTROL_ORIGIN:https://control.m0.test:8791 \
  --var M0_PREVIEW_ORIGIN:https://preview.m0.test:8791 \
  --log-level error
```

In a separate terminal:

```sh
npm run m0:preview:browser -- "$PWD/.local/m0-browser-tls-<unique-id>"
```

The driver accepts exactly that TLS directory argument, validates it lies under this repository's `.local/m0-browser-tls-*`, and reads secrets only into memory. It does not start or stop Workerd. Node HTTPS uses a dedicated CA, explicit IPv4 loopback lookup and fixed host/port allowlist. Chrome runs a fresh isolated temporary profile using `/Applications/Google Chrome.app/Contents/MacOS/Google Chrome`, independent contexts, `--no-proxy-server`, local host resolver rules and the **single certificate's SPKI allowlist**. `ignoreHTTPSErrors` is false. No system trust/hosts/profile or global TLS verification setting is changed.

The driver exercises actual browser document/JS/API/WS, copied complete ticket URL in other-tenant and same-tenant independent contexts, one-use concurrency against real DOs, challenge-less code rejection, iframe and parent/sibling DOM isolation, credential unreadability, Domain-injection failure, actual authenticated cross-origin control POST rejection, header/redirect/SSRF/raw-route/WS-Origin regression, logout, 20-second wall-clock access expiry, revoke and replacement generation, alpha/bravo origins and two simultaneous same-tenant Preview instances. HTTP/WS markers must match each expected generation; two independent observers of one instance must agree. At most two Sandboxes are active. Cases not reached on failure are absent, never marked passed.

Evidence is written once to `docs/evidence/runs/preview-browser-<timestamp>/artifacts/preview-browser.json`; only safe case names/statuses, origins, scope diagnostics and timings are saved. A screenshot is captured only after all auth queries have cleared and fixed content is rendered. Failure output omits raw exception text, auth URLs and credentials. Cleanup records each Sandbox destroy acknowledgment and closes the dedicated browser. The caller must stop Workerd and separately inspect its development proxy helper containers: `destroy_acknowledged` is **only** a Sandbox acknowledgment, not proof that every local helper exited.

## Cloud runner preparation (not executed)

`scripts/m0/preview-cloud.mjs` imports the same fourteen browser cases. Local invocation and the local TLS fixture remain unchanged. The cloud runner additionally checks declared ingress/raw paths and expands HTTP/WS credential denial after logout, real access expiry, Preview revoke and generation replacement. It checks still-live credentials against another tenant's Preview and another Preview of the same tenant; these raw protocol checks do not replace independent-context login-binding evidence. Original contexts still prove copied-ticket rejection. A correlated Chrome CDP request must explicitly report `Sec-Fetch-Site: same-site`, an actual principal Cookie, the Preview Origin, network 403 and CORS denial.

**No cloud G0-T07 run has been executed for this runner. The user authorized `riff-demo.gaojihe.cn` on 2026-09-06; the legacy Worker, route and demo DNS records have now been retired as explicitly requested; certificates do not yet cover generation subdomains. See [setup verification](../../docs/m0-setup-confirmation.md).** A real operator-controlled site, wildcard DNS routing to this Worker and TLS covering `p-<generation>.<preview-base>` are prerequisites. Keep the current dynamic generation host model. A workers.dev URL cannot substitute for this wildcard Preview base. The manifest's site is an operator declaration, not a built-in Public Suffix List determination; real browser CDP must confirm same-site behavior. Cross-site third-party cookies remain a separate unrun matrix.

The operator prepares the actual deployment and freezes the full scoped source inventory before making a manifest. This offline command prints the hash without starting a browser or making a network request:

```sh
node scripts/m0/preview-cloud.mjs --source-hash
```

Manifest schema (values below are placeholders, not deployment evidence):

```json
{
  "schemaVersion": 1,
  "environment": "staging",
  "accountId": "8b0d70250211aa10d89e20605a1c7e5e",
  "controlOrigin": "https://control.<operator-site>",
  "previewBaseOrigin": "https://preview.<operator-site>",
  "registrableSite": "<operator-site>",
  "managementOrigins": ["https://control.<operator-site>"],
  "ingressOrigins": ["https://riffology-m0-preview-staging.jihe-gao.workers.dev"],
  "worker": {
    "name": "riffology-m0-preview-staging",
    "versionId": "<actual-worker-version-UUID>",
    "deploymentId": "<actual-deployment-UUID>"
  },
  "container": {
    "applicationName": "riffology-m0-preview-staging",
    "imageDigest": "sha256:<actual-64hex-image-digest>"
  },
  "deploymentSourceSha256": "<frozen-scoped-source-hash>"
}
```

Unknown fields, wrong account/Worker, arbitrary alternate ingress, non-HTTPS/non-443 origins, origin paths/credentials, a control host inside the Preview base, and origins outside the declared site are rejected before any request. `managementOrigins` must contain only the exact control origin. `ingressOrigins` can contain only the pinned staging workers.dev origin above, or be empty with explicit missing evidence. Alternate ingress checks are anonymous: neither management Bearer nor browser Cookie may be sent there. The runner does not fetch account deployment metadata itself; the manifest is the operator's verified binding to Worker version, deployment and image digest, not proof inferred from project output.

Use an ordinary, non-symlink manifest file inside the repository and an owned **0600** file inside `.local/` containing only `{"M0_PROBE_TOKEN":"<token>"}`. A single `M0_PROBE_TOKEN=<token>` env line is also accepted. Tokens use 32–1024 URL-safe ASCII characters. Extra fields, duplicate keys, signing keys and unsafe file permissions are rejected. The signing key stays in the Worker and is never needed by the cloud browser driver.

```sh
node scripts/m0/preview-cloud.mjs <actual-deployment-manifest.json> .local/cloud-staging/preview.secrets.json
```

Cloud requests use real DNS, HTTPS/443, bundled public CA roots plus system CA roots and hostname validation. Chrome uses the same dedicated temporary profile/independent contexts with no local DNS rule, SPKI allowlist or certificate bypass. TLS-related environment overrides are rejected. Cookie-domain and parent-navigation attacks derive from the validated manifest, so they attack the actual tested site. `projectService()` separately injects the configured control origin and Preview base into the fixed runtime diagnostic source: `/redirect-control` really targets that control origin, and `/set-cookie` attempts a Domain on that Preview base. Request/project data cannot choose these values; neither diagnostic target nor instance marker authorizes access.

The only added management primitive is `GET diagnostics`. SDK 0.12.9 `getExposedPorts()` reads current forwarding state; no port is exposed to obtain a test URL. The DO discards every returned URL before serialization and rechecks the active generation after the SDK await. The cloud runner requires an empty result. Its raw path matrix covers control, Preview base, active/unknown generations and the declared default Worker ingress. A live SDK bearer URL replay remains **not_run-no-port-will-be-exposed**, not a fabricated pass based on an invented URL.

Evidence is written once to `docs/evidence/runs/preview-cloud-<timestamp>/artifacts/preview-cloud.json`. It binds the validated public manifest and manifest hash, scoped source inventory before/after, Chrome version, safe statuses, timings and explicit missing rows. A deployed-source mismatch fails before network activity; an in-run scoped-source change fails the receipt. Unrelated repository changes affect only the informational whole-repository hash. Secret/TLS directories are never inventoried or persisted. Queries, request IDs, raw headers, exception strings and tail output are not saved. Pending matrix rows retain `incomplete` if interrupted. Cleanup owns starts before dispatch and records only Sandbox destroy acknowledgment; cloud instance stop/billing reconciliation remains operator work. Even all cases passing yields `cloud_checks_passed_gate_not_evaluated`, **never automatic G0 pass**.

Both entry points have a non-renewable **300-second business deadline**, **600-request limit** (Node HTTP plus observed browser HTTP redirects and WS connections) and **8 MiB response budget**. Node counts incoming UTF-8 body bytes per chunk and limits each response to 1 MiB. The browser observer charges declared Content-Length immediately and reconciles completed response wire-body sizes, plus received WS payload bytes; it also rejects a single observed response above 1 MiB. Browser measurement is passive, without interception that could change CORS behavior. It is an event-observed limit, not an exact packet-level transfer cutoff: bytes received by Chrome before its size event or from aborted responses may be unavailable. Request failures are counted explicitly. Crossing an observed limit stops the suite and closes the dedicated browser; the overall deadline also bounds unfinished browser waits, evaluation, size accounting and slow/unfinished responses. No passing request resets these budgets.

`finally` receives a separate **45-second / 3-request / 256 KiB** cleanup reserve and attempts each of the at most three owned run/tenant scopes once in parallel, with at most 15 seconds per cleanup HTTP request. This reserve remains usable after business timeout, request exhaustion or byte exhaustion. New starts/enrollments/revokes cannot use it. Unknown mutation acknowledgments are retained and never automatically replayed, including when a response arrives after the deadline; idempotent cleanup is the explicit compensating action. Browser shutdown shares the cleanup deadline. A final process watchdog at 360 seconds writes a separate `preview-budget-abort.json` failure if shutdown still hangs and exits; this failure supersedes any earlier receipt and does not claim remote cleanup. The owned dedicated Chrome process is managed by Playwright's process exit cleanup. Neither budget nor watchdog starts, stops or signals unrelated user browsers, Workerd, Docker, or cloud resources.

Pure validation, without services:

```sh
node --check scripts/m0/preview-browser.mjs
node --check scripts/m0/preview-cloud.mjs
node --test tests/m0/preview-driver.test.ts spikes/m0-preview/*.test.ts
npm run typecheck
```

`tests/m0/preview-driver.test.ts` imports the standalone manifest and budget tests so the existing `tests/m0/*.test.ts` check glob exercises them without changing package scripts. The budget tests use real short wall-clock deadlines and pending Promises, with no server/browser/network, and assert independent cleanup plus rejection of late/unknown mutation replay.

The prior local `Network connection lost` close-phase SDK logs remain **unattributed**. Own rejected body cancellations are caught and unit tested; this does not show the SDK symptom was fixed. The cloud receipt retains `sdk_exception_investigation.status=not_run` and `runtime_error_free=unknown`. Separate sanitized, phase-correlated investigation must distinguish full HTTP reads, HTTP cancellation, normal/abnormal WS close, logout, expiry and destroy before concluding runtime error behavior. Do not persist raw tail URLs/Cookies, suppress all unhandled errors, patch dependencies speculatively or call cleanup acknowledgment proof of an error-free runtime.

## Evidence limits

Until a new driver receipt exists, this round's real browser/iframe/expiry cases are **not_run**. A successful receipt is local same-site/different-origin evidence only. **Cloud G0, production login, cross-site third-party cookies, cloud custom-domain ingress/TLS, cloud networking/container isolation, cloud WS lifecycle and cleanup under worker interruption remain not_run.** Synthetic fixed state does not validate numerical correctness, arbitrary project content or arbitrary application side effects. Local Chromium policy is not a browser-vendor compatibility matrix.

Previous implementation evidence is retained as historical evidence only: `preview-live-1788589137844/artifacts/preview-local-smoke.json` recorded fourteen HTTP/WS checks and Sandbox destroy acknowledgment for the former shared-origin transferable-capability probe. It does not prove the new identity/origin flow. Failed runs `preview-live-1788588767993` (helper-image pull before readiness) and `preview-live-1788588850508` (HTTP passed; WS transport failed before correction) remain intact. These old shared-origin/bearer results are historical context only. Run Wrangler/Container integrations serially; parallel sessions were observed to interfere with local image tags.
