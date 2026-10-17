# Account error fence follow-up — PR #231

Independent review of `82a0e6280e06fec9fdca4ef8a37b93618ef5f6c0` found that `renderProjects` consumed a delayed 401 using only view/list generations. A same-account focus identity check advances the identity epoch while leaving those generations unchanged. The old projects response could therefore sign out the UI while the newly verified ID remained ready. The original focused suite did not cover that path.

Two real local Chromium regressions hold the projects request and exercise the existing application. On the original implementation, the same-account-refresh case fails its assertion that the login UI must remain hidden; the current-401 case passes. After the fix both pass. The browser/identity/network remain synthetic intercepted fixtures, distinct from authenticated production acceptance.

API errors carry the identity epoch valid when an auth transition was observed, including the epoch change caused by clearing an expired display. Both auth-mutating catch paths check it again after asynchronous body parsing. A current projects 401 clears the owner and displayed ID; a stale one cannot sign out a newer verified account. The disclosure also requires `authenticated`, preventing an inconsistent auth state from exposing a copyable ID.

The original exact-head aggregate and the final fixed-head related/aggregate results are recorded separately in the PR delivery comments. A full pass on the original source does not dismiss the new regression. [Negative-control and source evidence](../evidence/releases/account-identity-auth-fence-20261017.json). No #208/#226 changes, merge, deployment, policy changes or real-provider operations are included.
