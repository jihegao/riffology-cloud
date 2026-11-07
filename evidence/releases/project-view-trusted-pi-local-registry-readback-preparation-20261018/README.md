# Local-only Registry readback preparation

Prepared, not executed; no new grant is present. Review [EXECUTION.md](EXECUTION.md), [AUTHORIZATION.md](AUTHORIZATION.md) and [scope.json](scope.json).

- 12 operational/source inputs are fixed by [operations-manifest.json](operations-manifest.json): SHA256 `16313c7193782acce5cd88de7c0e2caf97c76e59c807b581b8b58ef54642eafa`.
- All 16 preparation inputs, including independent reader, fixtures, source contract and safe checks, are fixed by [complete-source-binding.json](complete-source-binding.json): SHA256 `919648f9e77ea0a77033e9aaa1fd3aefda24510ae5dd7a55ba19ba2723571572`.
- Final author suite: [15/15 actual receipt](author-validation/final-formatted-complete15.receipt.json) on the the exact final driver bytes after the whitespace-only correction; no auth/SSH/network/Docker. The bound [earlier author checks](offline-checks.safe.json) retain the prior13 snapshot and grant-expiry5 selected run (2new+3existing), which are distinct runs rather than18 unique cases. First NameError fixture failure remains local history.
- Independent-reader author checks are [reader-offline-checks.safe.json](reader-offline-checks.safe.json): 15 new synthetic fixtures, no actual SSH/Registry/auth/Docker. Its result requires root's original execution transport ACK; it never independently grants a publication or merge.
- [source-reuse-contract.json](source-reuse-contract.json) binds unchanged OCI verifier/auth functions and the intentionally changed routing/content/expiry contract.

The same c263 request/source/tag/archive is retained. One read-only SSH revalidates the original archive and the latest stopped14 records before auth; it creates no AMD files or routes and receives no credentials. A separately approved new local phase can mint once-only15-minute pull-only credentials in Mac memory and perform52 fixed local GET slots through existing7892. GETs end by the earlier of720 seconds or this grant expiry. A complete exact-size/SHA body is required for every original descriptor slot. AMD returns no raw config/Env or archive body; the Registry config response is streamed and hashed locally without persistence. This is cryptographic content identity to the AMD-reverified original blobs, not a direct comparison of two raw config byte objects on the Mac.

No performance guarantee follows from the public network observations. Unknown/partial stops remain pending; no retry, re-push, export, build, deployment, new Turn or runtime-window extension is included. The existing actual partial result is [fc06f3a](https://github.com/jihegao/riffology-cloud/blob/fc06f3ae73623006baed9691b88f577039caaa66/docs/project-view-trusted-pi-original-registry-readback-result-20261018.md).

[Final independent review](reviews/final-source-review.json) and [root source checks](reviews/root-source-check.json) verify the fixed inputs. [Documentation bridge](documentation-correction.safe.json), [formatting bridge](formatting-correction.safe.json), and [complete public inventory](inventory.json) preserve the intermediate preparation history.

The full [logical source review](reviews/source-review-before-format.json) remains applicable through the exact one-space/AST-equivalence correction reviewed in the final delta record.
