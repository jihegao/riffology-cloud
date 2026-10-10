# Assets preservation decision proposal — not approved

This proposal separates a reviewed `keep_assets` upload contract from a full asset-byte audit. The current `assetPreservationEvidence` still returns `coverageComplete:false` for Workers with assets. Its new `contractCandidateReady` describes a candidate for approval, not a release permit. No production capability or standard is changed by this document.

## Proposed contract standard

An explicit decision must approve `keep-assets-contract-v1` for the exact existing account/Worker, frozen source/metadata packet and the eight reviewed phases. Only then may a future implementation evaluate a separate `assetContractAccepted` gate; `assetBytesAudited` must remain false. Neither `keep_assets:true` alone nor an operator's mutable flag is sufficient.

The preflight and post-write evidence must establish the same existing Worker and ASSETS binding, matching asset configuration digest/presence, frozen before/after deployment and version identities, exact source module hashes, complete namespace/container preservation and independent pipeline guards. The upload metadata must retain `keep_assets:true` and omit the entire explicit `assets` field (including upload JWT/configuration). Multipart must contain exactly one metadata part and only frozen reviewed JS modules; reserved `assets`/duplicate metadata parts are rejected. No assets-upload-session, assets upload or new asset manifest request is allowed by this publisher's transport. An independent operator must exclude concurrent publishers throughout the read/write interval. Unknown acknowledgement/readback stays pending under its original identity.

The current implementation adds the omission/reserved-part rejection and a candidate evidence projection, while keeping every live asset-dependent PUT blocked. It does not implement the future approval gate.

## Distinct full-content audit

A full audit needs an authoritative complete asset-set identity/manifest tied to the exact frozen Worker version and every listed content digest. Matching runtime configuration, Worker etag, historical asset tests or GETs for a known subset cannot prove the complete asset set. The reviewed control-plane contract exposes no GET inventory that establishes this complete manifest. Extra public asset downloads or an alternative enumeration are not authorized by this proposal and must not be used to claim completeness.

If the contract standard is approved later, its receipt must state `assetBytesAudited:false`, `assetSetIdentityVerified:false` and the absence of complete inventory. If full-content audit remains mandatory, publication stays blocked until that independent evidence exists. The two standards must never share an ambiguous `assets preserved` result.

The upload contract is documented in [Cloudflare direct upload](https://developers.cloudflare.com/workers/static-assets/direct-upload/). Actual current full-state acceptance, raw HTTP readback, publisher exclusion and user validation remain separate prerequisites.
