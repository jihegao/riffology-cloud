# Two fixed public source versions — independent follow-up

Current main resolved through the public repository branch API to **d5d326e5d4dd09af4af1f2ea9926df2a991582c2** (commit date 2026-10-09 01:45:30 UTC). Both execute/helper were fetched at that complete commit; the earlier 37cc review below is a separate historical version. Actual connected deployment remains unknown. All eight retained source files match their Git blob SHA1; [source index](public-source-index.json) records per-file SHA256 and commit URLs.

| Behavior | 37cc36c01e19e674519442d0fee03ebc8827e9ae | d5d326e5d4dd09af4af1f2ea9926df2a991582c2 |
| --- | --- | --- |
| Max retries / total attempts | 3 / 4 | 3 / 4 |
| Returned status causing retries | 429 only | 429 only |
| Fetch exceptions | Retried | Retried |
| Method restriction | None, includes PUT | None, includes PUT |
| Server wait | Positive numeric seconds capped at30s | Integer seconds/HTTP date, or exhausted Ratelimit reset; >5s returns429 |
| Maximum scheduled sleep total | 90s | 15s |
| Request body | Reused | Cloned before nonfinal attempt |
| End-to-end wall-clock budget | Absent | Absent |
| Caller retry-control exposure | Absent | Absent |

Current [execute](https://github.com/cloudflare/mcp/blob/d5d326e5d4dd09af4af1f2ea9926df2a991582c2/src/tools/execute.ts#L46-L48) has the identical Git blob as the older version. Current [retry helper](https://github.com/cloudflare/mcp/blob/d5d326e5d4dd09af4af1f2ea9926df2a991582c2/src/utils/fetch-retry.ts) clones Request bodies; the offline body-consuming PUT mock reads the full synthetic body four times, versus once in the older runtime mock. Twenty pinned-helper counterexamples pass using only mocked fetch/sleep and Node type erasure. Results are [retained](retry-offline-counterexamples.json); no production endpoint was contacted.

The independent conclusion is unchanged: revise GET semantics to accept established bounded read-only proxy retries with outer budgets and deployment/configuration brackets. Do not promote either public implementation into a no-replay PUT channel. Existing helper wall-clock and deployed-version gaps remain explicit.

## Earlier single-commit review — applies only to 37cc

# Independent public MCP retry review — 2026-10-10

Reviewed immutable public Cloudflare MCP commit `37cc36c01e19e674519442d0fee03ebc8827e9ae`. This identifies source, not the actual connected server deployment. Its advertised `0.1.0` version does not attest this commit. No production request or credential access occurred.

[GlobalOutbound](<https://github.com/cloudflare/mcp/blob/37cc36c01e19e674519442d0fee03ebc8827e9ae/src/tools/execute.ts#L29-L46>) passes every allowed-host Request to the retry helper, supplying only a caller label. It has no method filter. The [helper interface](<https://github.com/cloudflare/mcp/blob/37cc36c01e19e674519442d0fee03ebc8827e9ae/src/constants.ts#L21-L28>) includes PUT and other writes; its request arguments expose no retry controls. [Non-code-mode](<https://github.com/cloudflare/mcp/blob/37cc36c01e19e674519442d0fee03ebc8827e9ae/src/tools/non-codemode.ts#L101-L105>) also calls the retry helper without a method policy. Thus a single tool call cannot establish one wire dispatch. Request body reuse may prevent some subsequent code-mode dispatches, but it is not a dependable write safety guarantee.

The [retry implementation](<https://github.com/cloudflare/mcp/blob/37cc36c01e19e674519442d0fee03ebc8827e9ae/src/utils/fetch-retry.ts#L10-L110>) defaults to three retries after the first attempt. HTTP 429 and thrown fetch errors trigger retries; other returned statuses, including 500/503, return immediately. Positive numeric Retry-After seconds are capped at 30 seconds per sleep; HTTP dates fall back to exponential delay. Default jitter produces total fallback sleep between 3.5 and 7 seconds, or at most 90 seconds with numeric Retry-After. These exclude fetch time: there is no helper deadline, per-attempt timeout or abort-aware sleep. A previously received 429 can be returned after later errors. No success/applied-state inference should use that result.

Adjust the existing contract by method and semantic endpoint. Existing bounded proxy retries are acceptable for allowlisted read-only control-plane GETs with explicit outer request/aggregate budgets, expiry checks and current deployment/latest/settings/configuration brackets. Reject late evidence and add no outer retry loop. Caller timeout does not prove remote retries stopped. Public source models the risk; actual deployed retry policy/bounds remain unconfirmed.

PUT and experiment/budget-consuming actions remain blocked on this default proxy. Require a separately established single-dispatch, no-replay path at every layer; a journal, rawBody, idempotent method name or one application call is insufficient. This review permits no write and does not accept a live transport.

[cloudflare.request](<https://github.com/cloudflare/mcp/blob/37cc36c01e19e674519442d0fee03ebc8827e9ae/src/tools/execute.ts#L87-L118>) omits redirect policy. GlobalOutbound reconstructs the Request while preserving its options; the retry helper does not override redirect. A raw fetch integration must preserve manual redirect through every layer, reject all 3xx/Location responses locally and establish that no redirect dispatch occurred. Default helper requests do not supply that proof.

The MIME/parser implementation will receive a separate frozen-source review. No original raw HTTP hash is asserted for web-rendered public source. Local direct public fetch returned `fetch failed`; the review used public web source without escalation or alternative credentials.

