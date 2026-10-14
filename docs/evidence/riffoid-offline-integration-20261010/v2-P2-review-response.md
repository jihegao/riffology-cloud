# P2 follow-up — isolated offline repair

Independent static review reported two P2 findings. Both were reproduced by
failing offline fixtures before repair (p2-before-fix-*), then fixed. The review
was static; the reviewer did not run tests. This response does not mark the new
revision independently accepted: re-review is pending.

1. Time order: journal event time is nondecreasing; marker, cue, stop, cleanup,
   drain, privacy restore and log restore timestamps are retained. Run.startedAt
   must follow marker and cue. Publication startedAt/readbackAt must be valid and
   ordered, including between Workers. Restore writes cannot begin before drain;
   logs writes cannot begin before private restoration readback. Late receipt
   delivery cannot hide an earlier unsafe write. The whole packet is frozen into
   initial journal state. These are consistency checks, not receipt authentication.
2. Identity: complete baseline metadata/module hashes seed a per-Worker version
   ledger. Seen versions cannot change either hash, and seen deployments cannot
   change version. Negative fixtures cover baseline and previously seen IDs.
   Consistent identity reuse remains valid, without authorizing lifecycle rollback.

Final targeted coordinator run: 14/14 passed, exit 0; source hashes are recorded
in p2-final-test-record.json. The normal complete cleanup/drain/private-restore/
logs-restore path also passes. P2 added no signing, acceptance or request budgets.
Worker runtime and bundle inputs are unchanged; existing Workerd/typecheck evidence
remains applicable and was not blindly rerun.

The new publication timestamps are required. Older receipt journals missing these
fields are rejected, never supplied with guessed times. A real publisher and
independent readback adapter must supply authentic identities, contents and times.

Production readiness remains false: actual production adapter, authoritative
semantically read-only drain source and reliable native A cleanup are unresolved.
300 seconds bound protocol admission only, not total log-pause/maintenance time;
that interpretation must remain explicit. No integration, push, install or
production operation occurred. Independent re-review and any later integration
are separate work.
