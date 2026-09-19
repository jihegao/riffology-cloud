# Retained release 727c40f

`727c40f.json` and `profiles-727c40f.json` are copied verbatim in content from
release `727c40f`'s static index and runtime profiles. The two unique files under
`bytes/` are the original host bundle and package-lock, verified against that
index. Shared assets are reproduced by the current pinned asset preparation.
No old profile hash is redirected to a new host.

Normal `execution/materialize.mjs` includes this baseline automatically and
checks every original byte hash/length and delivery descriptor. Consequently
clean CI and `materialize-browser-preview-web.mjs` preserve the same history.
Missing or mismatching retained bytes fail the build.

Run the exact old Queue/Mesa packages against the current asset delivery with:

```sh
RETAINED_PROFILES=services/browser-preview/execution/retained/profiles-727c40f.json \
OUTPUT_DIR=.local/browser-preview/acceptance-retained \
node services/browser-preview/runtime/browser-acceptance.mjs
```

This uses real Chrome/Pyodide and checks both independent cold pages and refresh,
as well as playback, seed boundaries and isolation. It is local runtime evidence,
not authenticated production project acceptance.
