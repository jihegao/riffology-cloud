# Managed candidate release — 2026-10-13

[PR190](https://github.com/jihegao/riffology-cloud/pull/190) and
[PR194](https://github.com/jihegao/riffology-cloud/pull/194) are merged and deployed
for [#178](https://github.com/jihegao/riffology-cloud/issues/178) and its minimal
receipt fix [#192](https://github.com/jihegao/riffology-cloud/issues/192).
At 2026-10-13 00:56:33 Asia/Shanghai, Gateway version
`728e5141-d859-4416-8c79-9b92b3ed0b16` received 100% traffic in deployment
`6d9f4609-e541-4f6c-a99c-32f18d18510d` at https://app.riffoid.com.

Candidate v2 preserves the model's current Python, Spec, adapter, lock,
visualization, trace, summary and optional restricted-JS frontend roles through
save/restore. It removes the forced road/lane template and exposes invalid or
legacy candidate diagnostics. Legacy v1 retains its saved view and reports missing
trace validation. The Journal fix recognizes only the exact old accounting
shape or the validated new candidate metadata; real late execution and arbitrary
extra fields still invalidate an earlier checkpoint.

## Source and release identity

The deployed source is
[3e9b97b6](https://github.com/jihegao/riffology-cloud/tree/3e9b97b6d8edeecddd8ce1c995c827dc225a8467),
tree `2c56db59ca7c050a7e83fc36b2d1d6660ccc943a`, captured on
`codex/managed-live-release-20261013`. Its parents are merged main `c27d7e7`
and the proved executable-equivalent live-domain source `8e5f9b1`; it also retains
the already-deployed #193 riffoid brand bytes. The feature/fix merges are separate
from this release composition. Existing domain/brand work is not thereby claimed
merged into main.

The downloaded old Gateway module was reproduced byte for byte after restoring
only esbuild-generated source/module path labels: 5,497,752 bytes, SHA-256
`0e882e02295d9e8630593f93e1fada65dd7d3a04a3361b8a2f20c70d2dae8290`.
The historical manifest's original commit is unavailable in local Git; `8e5f9b1`
is a demonstrated executable-equivalent source, not an original-build authorship
claim. The later `04f00d6` source contained undeployed maintenance validation and
was excluded from the final package.

The deployed module is 5,738,372 bytes, SHA-256
`3f9ade64bedbd295495c4ca960e2cd0a3a576ff8681966454ce54371604b8fe7`.
Cloudflare content readback matches it exactly. `content/v2` returns the latest
uploaded script; an independent deployment readback confirmed the named version
at 100% traffic. An earlier main-only uploaded candidate was never deployed after
the live-deployment guard caught the concurrent brand release.

## Actual checks and remaining acceptance

Final-source M1 passed 348 tests. M2 passed 921 and UI passed 21 on the preceding
composite; their final relevant source, test, package and lock inputs are identical,
verified independently. Typecheck, asset materialization and bundle parsing passed.
The initial missing-system-Chrome attempt was superseded by installed Chromium
runs. These counts overlap with focused checks and must not be added. CI allowance
was ignored per user instruction; CI is not reported passed.

Full before/after API snapshots preserve all 99 binding identities and policy
values, compatibility flags/date, 23 SQLite exports, 5 Gateway container
associations and all 15 account container configurations. Only deployment
annotations differ in script settings. These comparisons do not establish
container instance health or real turn release behavior.

All 91 live Gateway assets match local SHA-256: 23 web files and 68 immutable
Preview assets. Only `app.js` and `i18n.js` differ from the preceding brand release;
all eight saved runtime profiles remain available. All three isolated frame
responses match their pinned hashes and CSP; query, Cookie, Authorization and an
empty POST are rejected. Entry, Browser Execution and www deployment versions
are unchanged. This release did not start model/provider/Run requests, create
projects, replay requests or alter historical data and usage. Global authoritative
execution counters were not collected; no global zero-execution claim is made.

[#178](https://github.com/jihegao/riffology-cloud/issues/178) and
[#192](https://github.com/jihegao/riffology-cloud/issues/192) remain open at
Acceptance for the target invited-user flow. This release has no new production
model Revision/package identity: authenticated save receipts, historical restore,
parameter/seed modification, reload and cross-identity acceptance remain pending.
Browser results remain **local/unverified**; candidate reported output remains
**not-recomputed**, and paid execution/Verified Evidence was not accepted.

General manifest and real bounded dependency/debug work remain
[#182](https://github.com/jihegao/riffology-cloud/issues/182) and
[#183](https://github.com/jihegao/riffology-cloud/issues/183). The authoring Mesa root
allowlist has not been removed; existing saved dependency closures are retained.
The requirements/SysML contract from PR189 is design only. The airport, queue and
grid ecology full acceptance and compiler/Rust integration are not delivered by
this release. Future releases must reconcile the actual deployed domain/brand
composition and full live configuration before cutover.

[Release evidence](evidence/managed-candidate-release-20261013.json) records source,
module, runtime, test identities, exact log hashes and remaining gaps.
[Static readback](evidence/managed-candidate-release-20261013/static-readback.json),
[live-source audit](evidence/managed-candidate-release-20261013/live-source-audit.json)
and [composition check](evidence/managed-candidate-release-20261013/source-composition.json)
are separately inspectable. Prior local fixture evidence remains
[2026-10-12](evidence/managed-candidate-local-validation-20261012.json).
