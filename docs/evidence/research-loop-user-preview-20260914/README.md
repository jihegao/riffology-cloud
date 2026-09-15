# User-preview Research Loop evidence

This directory contains the sanitized, reviewable subset of the live acceptance evidence described in [the acceptance report](../../user-preview-research-loop-acceptance-20260914.md). It records the deployed release, accepted experiment, verified claim, export replay, explicit assumption edit, and the follow-up experiment bound to the edited Revision.

Authentication cookies, browser profiles, raw Agent session state, R2 object keys, and unredacted workspace snapshots remain outside Git. Durable product identifiers, version hashes, Run artifact hashes, and aggregate Cloudflare inventory are retained because they are required to reproduce the acceptance chain.

From the repository root, verify every committed artifact:

```sh
(cd docs/evidence/research-loop-user-preview-20260914 && shasum -a 256 -c SHA256SUMS)
node docs/evidence/research-loop-user-preview-20260914/verify-evidence.mjs
mkdir -p /tmp/riffology-assumption-replay
python3 docs/evidence/research-loop-user-preview-20260914/assumption-model/run.py \
  --input docs/evidence/research-loop-user-preview-20260914/assumption-input.json \
  --output /tmp/riffology-assumption-replay/result.json
```

For the original exported package, `export-replay.json` records both package verification and execution inside the exact recorded Linux/amd64 runtime image. The full ZIP remains local because it includes raw research source and session-adjacent inventory; `export-manifest.json` is the sanitized package inventory committed here.

`assumption-change.json` distinguishes the failed final Agent response from the successful durable save. The saved checkpoint archive hash, Model Spec hash, source excerpt, and later experiment version all bind to the same edited Revision. A failed conversational response is not claimed as a successful turn.
