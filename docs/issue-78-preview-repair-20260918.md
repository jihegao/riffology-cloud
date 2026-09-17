# Issue 78: Queue/Mesa preview repair

## Release boundary

PR #81 brought the reviewed live-only Luna cache/error-hint and exact failed-pending rollover fixes into main (`861159c`). This preview change starts there, independently of #77 / PR #80. No model requests, new budget windows, gate opening, historical ledger settlement, container image changes, or project deletion are part of this release.

## Diagnosis and repair

- Both affected saved models contain the reviewed older platform adapter, SHA-256 `fa7987095bbc29f2c6d87e9b0f815415f88c9079ad7070fb7fe8b91e7ebf0898`. The validator and browser loader previously accepted only the newer trace-audit adapter. Both invoke the same saved `model.run(config)`; local acceptance of the old adapter does not create server audit evidence.
- Mesa's exact six-package lock already matches the pinned Mesa profile. The displayed dependency rejection came from the standard-library profile, hiding the Mesa profile's adapter rejection. The selected diagnostic now prefers a non-dependency rejection when neither profile is runnable.
- An explicit validator generation permits a bounded rebuild of old persisted unsupported rows. The existing transaction/source/scope guards and three-attempt alarm limit remain intact. Current-generation unsupported records do not loop on refresh. Source bytes, revisions, old receipts and history remain unchanged.
- Local preview and closed cloud gates are separate UI states. Authenticated `/api/me` reports finite execution flags; Verify/service/interactive preview controls obey them. A stale standalone package link never silently switches identity.
- Project cards distinguish workspace creation, source origin, saved model and local preview state. Reversible title-based acceptance-project/search/preview filters do not delete projects. Metadata reads are bounded to two concurrent project lanes and checked against tenant/view/list generations; non-ready workspaces are not read.
- Only exact reviewed adapter digests were added. Package/source hashes, fixed dependency locks, sandbox isolation, CSP and network restrictions remain unchanged. Generated host/profile/static delivery receipts were regenerated.

## Evidence before release

- The authenticated ordinary-user Safari session reproduced the existing failures and downloaded both research exports. The actual immutable archives, not substitute model fixtures, pass the repaired server validator, packager and browser package loader.
- Queue: revision `612e30322e50f0f4f1aef453e62736d513bf03a59a4f00d6348151748f57feeb`; source SHA-256 `56bf53a1b8b17f66eb97648acd0995d7e78e8b3363a43291374b2aaf4f88f812`; repaired package `e6569234d647b2322684715fe503fab6657f015560b9b2548ae02733c05d7282`.
- Mesa: revision `ccd28c4261894c676be368af49e088fecd2ae12277548f3206856c3e26e3f861`; source SHA-256 `e706f0e2bb4e9a9546a470126459fcc06b62ca23a3e32df4971940a9a4d04cce`; repaired package `bcedbb251bc8f18230dccd92899355ee4febf8abcc174153ffd1b34b1976b08f`.
- Typecheck, syntax and diff checks; M0: 350 passed / 1 skipped; M1: 213 passed, plus updated UI/filter coverage; M2: 706 passed; M3: 798 passed / 10 skipped, runtime/execution 15 passed, phase-1 scripts 9 passed, model scripts 87 passed. Final affected UI suite: 53 passed; final preview panel suite: 10 passed. Fixture browser tests are not logged-in production acceptance.
- Latest Workers types `5.20260917.1` were inspected for the storage/transaction interfaces; the project dependency lock was not upgraded.

## Deployment and acceptance status

At preparation time, gateway version `daaf58ec-4dc8-4ca5-9e83-2e021cc0e91f` serves source `5d3056d`; execution Worker version is `2b9bfc38-4994-495c-ba36-df51b6265ca4`. Frozen readback configuration preserves all resource bindings and namespace IDs, existing container associations, variables, secrets, compatibility flags and closed gates. Upload/readback/deploy must check these again and reject concurrent changes.

Post-deploy logged-in acceptance remains required: both actual projects, local run, parameter/seed rerun, play/pause/step, refresh and standalone reopen with correct identities, historical results unchanged, and before/after authoritative compute counters. The Mac became locked during the read-only pre-acceptance counter step; Safari cannot proceed until manually unlocked. Do not close #78 or claim online acceptance from offline tests/public HTTP checks.
