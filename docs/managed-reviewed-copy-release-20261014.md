# Issue #202 reviewed-copy first Run release — 2026-10-14

[#202](https://github.com/jihegao/riffology-cloud/issues/202) adds one narrow
bootstrap path for the designated reviewer to run a newly copied, reviewed
published model through the existing Managed schema 2 route. It does not change
Private Beta admission, invitations, provider routing, native capacity, release
guards or historical accounting. The user explicitly authorized the designated
Gmail reviewer account to make this copied-project cloud Run.

The implementation commit is `f6a9981a7f9511328b63c3f4ef86dac008b26b7f`.
The deployed source composition is
`e422b297e75b8ee1f32caaa43e0d451a5f7a95d9`, built from the exact prior live
baseline `4d0995a57367ffbd5cf18e972936e1afd7372935`. The baseline module was
reproduced byte for byte at SHA-256
`87560a85eac9b8ddb7fa113260777db938917745ad21442516be53075852ac27`.
The deployed module has SHA-256
`517ce37d817efa0f3e17d1add49fadb5e30c91b68d0465dd2ddb40737ffb1818`
and 5,741,849 bytes; live readback matches it.

Gateway version `9f472694-4aa5-4f0f-8fda-ceddd02e1e88`, version number 219,
was served during this acceptance by deployment `0dbc1645-cba0-4db0-bb87-ace9ce0e119a` at 100%.
Readback preserves 99 bindings, 23 SQLite Durable Object exports, five container
associations, the compatibility date and the existing asset configuration. No
namespace, container image, UI source or asset source was added. Asset bytes were
not independently re-probed for this narrow release.

Admission uses current catalog facts rather than an email or fixed project bypass.
The current actor must own the ready, unarchived personal copy, remain an active
operator at the same auth version, and be the operator who approved the published
submission. The copied project must still bind the exact published model version
and content digest. A fresh Managed actor must have no prior budget, Turn,
execution binding, stop, unknown or cleanup history.

The public model read reported `reviewed-copy-first-run` and allowed the first
native Run before submission. This check is read-only: it does not create a
budget or table and does not call a provider or native runtime. Admission stores
one distinct Run ID before native start; the normal `beforeStart` check revalidates
the same actor, source and Run ID. The same ID is idempotent, while a different ID
is rejected. Existing Managed budgets retain their prior reservation behavior,
but their read-only marker reports unavailable when an earlier Turn is unknown,
running or awaiting cleanup.

The frozen author archive SHA-256 is
`6ab937da5f07f6415ea7c4014e1cb672c31b3210b5270934961d29572239c7be`;
the copied initial workspace archive SHA-256 is
`3e3360f6fa0440215f0b80908a6b4d4de2d2b819a863aea0716a6e42b9d4bcf7`.
The platform repackaged archive identity is different, while the six model
source files and the same 98-byte README match byte for byte. The README SHA-256 is
`555cb02767ed32c32ad1949f9a862a944776d4ade871579a16f2b42519b9eb1c`.
No specific archive-metadata cause is inferred. Both packages retain Spec SHA-256
`776179d01e8adc25fda68bcf74329d1c5bb301ac787e3c6e3f92bdcfac72e5b0`.
The publication content digest remains
`21121a2dcf3b7ea036f9d8de766f2b215f002019c7d66ccf7ff7c7f23f77fc67`.

Three new production-class Workerd checks and 54 focused and adjacent checks
passed. The full 961-test M2 suite started before the final existing-budget
readiness-marker tightening and passed with zero failures, cancellations or
skips. After that tightening, the three new Workerd checks, TypeScript type
checking and whitespace checks passed again. Independent review found no
must-fix issue. The conservative operational edge remains: if admission is
persisted but the Workspace loses its Run-record write, the unique Run ID remains
occupied and must not be bypassed with a different ID.

The designated reviewer submitted exactly one ordinary UI request for
`density_percent=57`, `steps=5`, `seed=20261001`; the server returned HTTP 202.
The Run completed with `initial_trees=523`, `burned_trees=53`,
`trees_remaining=470`, `active_fires=6` and
`burn_fraction_pct=10.133843212237094`. The final authenticated read reports
`released=true`. The original copied-project scope remained at zero provider
Turns and Sessions, while its native simulation count moved from zero to one.
The request trace contains only the expected Run POST; no Workspace Turn or
Hosted Session was created, and quota occupancy and unknown count returned to
zero. The one-Run allowance is consumed and the subsequent model read reports
`canRun=false`. This establishes the authorized reviewer copied-project
acceptance for #202. Fees remain unknown and are not recorded as zero. A third
ordinary non-operator identity has not completed this acceptance.

[Sanitized machine-readable evidence](evidence/releases/issue202-managed-reviewed-copy-release-20261014.json)
contains hashed user/project/workspace/Run identities and excludes credentials,
headers, settings values, plain-text environment variables, module bodies,
source archives and raw logs.

A subsequent separate main integration replaced this acceptance deployment at 08:53:29 UTC, after the copied Run and count proof had passed. Read-only follow-up observed Gateway `d9ceec61-1e5f-48cc-8a51-3abdb4b06614`, deployment `54f253dd-c7b3-4407-867d-b9856642c1ff` at 100%, reported source `eba528f7`, and module SHA `141ee79098a0ed3f799f2fb2c9f5dde3ba65a2d73317227f9e15b1037077d41a` (5,795,550 bytes). Its module retains the reviewed-copy helper, readiness RPC and second-Run fence; the original copied Run remains completed/released, with zero provider Turns/Sessions, one native Run and zero occupied/unknown quota. No native Run was repeated on this later version. The deployment identities above describe the actual Fire acceptance interval; broader main-integration acceptance is separate.
