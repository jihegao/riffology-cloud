# Issue 77 offline evidence

The safety checkpoint is `3f4bee9b3b8dd5211af669066dce8afd27a85b91` on
`codex/issue-77-safety-checkpoint`. It preserves the work made against `40aee17`.
The implementation was then cherry-picked onto main `08f7b72` as `e7736aa`, in
an independent worktree. The original worktree and its pre-existing documents
were left intact. This directory does not contain raw user sessions or credentials.

`baseline.json` records the two actually reproduced pre-fix failures.
`checkpoint.json` is a historical progress snapshot, not final acceptance.
`issue73-input-fingerprints.json` identifies local uncommitted context; it does
not turn that context into a released experiment. The final validation manifest
and SHA256SUMS distinguish the integrated source and verification results.

Reproduce current checks from the implementation worktree:

```sh
npm ci --ignore-scripts
mkdir -p .local
npm run check
node --test tests/m2/backend-shared-contract.test.ts
```

The `.local` directory is required by existing temporary-directory tests in
main. The first clean-worktree attempt failed with ENOENT before it was created;
this was an environment setup failure, not a waived assertion.

For the specific before/after failure, create a disposable worktree at
`40aee17ed810430ee71fa4afb02af6fecf59b26a`, copy **only** the two test files from
the implementation into it, and run:

```sh
node --test --test-name-pattern='issue 77: reordered JSON|issue 77: journal replays' \
  tests/m2/product-turn-runtime.test.ts tests/m2/turn-journal.test.ts
```

That baseline rejects reordered JSON member keys. The same command against the
implementation passes. The baseline procedure must not replace runtime source
with the new code, or it would no longer be a before-test.

Managed tests use an injected synthetic transport, not the OpenAI service.
Its outputs are candidate observations with independent usage/save/acceptance
states. The real RevisionStore test runs in local Workerd with outbound access
disabled and verifies a Managed reference manifest without Pi placeholder data.
The shared Pi/Managed test runs both through the same TurnJournal receipt checks.

Formal Mesa execution uses latest main's pinned server profile. Schema tests
verify exact profile selection and arbitrary-lock rejection; native Docker
acceptance requires its explicit opt-in and image. Skipped Docker/live suites
must not be described as passing live execution.

Phase 5 and production deployment were not authorized or run. This work makes
no paid call, settles no unknown usage, switches no production route, and does
not close the issue on the strength of offline evidence.
