# Phase 1 user-preview evidence

Read [the acceptance report](../../phase1-user-preview-acceptance.md) for scope, failures and limitations. The four accepted runs and two rejected generated-model runs are distinguished in `experiments.json`. `continuation.json` preserves observed model answer errors. These do not overwrite immutable Run data.

`release-manifest.json` is a structural release record; `final-cloud.json` is separately collected, sanitized, replayable Cloudflare inventory input. Structural validation is not a substitute for the underlying observations. All cloud instance pages were collected; pagination cursors are preserved but no authentication credentials are included.

From the repository root, revalidate the recorded inputs:

```sh
node --input-type=module <<'JS'
import fs from 'node:fs';
import assert from 'node:assert/strict';
import {validatePhase1Evidence} from './scripts/m3/phase1-release-profile.mjs';
import {validatePhase1Inventory} from './scripts/m3/phase1-inventory.mjs';
const base='docs/evidence/phase1-user-preview-20260914/';
for (const [file,validate] of [['release-manifest.json',validatePhase1Evidence],['final-cloud.json',validatePhase1Inventory]]) {
  const result=validate(JSON.parse(fs.readFileSync(base+file))); assert.equal(result.status,'passed'); console.log(file,result.status);
}
JS
(cd docs/evidence/phase1-user-preview-20260914 && shasum -a 256 -c SHA256SUMS)
```

The ordinary-browser execution helper is `scripts/m3/phase1-user-browser.mjs`; use its persisted receipt/intent files and the release runbook for any future authorized acceptance. Do not resubmit a delivery-unknown request under a new identity. Authentication material, raw sessions, raw cloud logs and browser profiles remain outside Git.

`models/` contains selected real files from SHA-verified R2 Revision archives. `validate-model-matrix.py` consumes the original archive; its recorded report includes that archive digest. Selected files alone are not asserted to recreate the original tar byte stream. `verify-queue.py` provides the separate CSV invariants checker.

The downloaded CSV artifacts retain their original CRLF bytes so their R2 digests remain verifiable. Whitespace review used `git -c core.whitespace=blank-at-eol,blank-at-eof,space-before-tab,cr-at-eol diff --cached --check`; no artifact line endings were normalized.
