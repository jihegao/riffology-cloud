# Native publication review copies — 2026-10-17

These are byte-identical audit copies of the locally frozen prepare/sender, their offline tests and review contract. Source hashes and actual offline results are in [the proof](offline-sender-review-proof-v3.json) and [independent review](independent-publication-tool-review.json). No raw configuration, secret value, OAuth, asset JWT, real grant or private metadata body is included.

The operational files live under `.local/jhg46-browser-native-publication-20261017/`; relative paths in these copies describe that operational location. Do not execute the review copies from this evidence directory. The 31 tests were run in the operational location before copying; no new test run is claimed here.

The candidate is implementation `9b993bd3`, bundle `7d6520d3…` and 96 assets. [Source/commit closure](source-commit-binding-v2.json) is independently checked. The missing-grant CLI refused before loading credentials or a real client. Technical candidate finalization grants no publication permission. Actual merge proof, a new human grant and same-request fresh Personal before/after witnesses remain required. See [the publication packet](../../../docs/project-view-browser-native-publication-packet-20261017.md).
