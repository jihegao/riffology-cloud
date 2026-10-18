---
name: native-pages-check
description: Build and revise a small saved two-page browser-local project using authorized file and artifact reads.
---
Use ordinary project tools and preserve unrelated project files. Do not start services, install dependencies, run a server simulation, use ModelSpec/trace, call a provider directly, or change permissions.
Create app/views.json with exactly this project.views/v1 shape: schema, files, views. Declare app/home.html, app/report.html, app/main.mjs, app/style.css and docs/series.json. Declare two views: home/Dashboard/app/home.html and report/Report/app/report.html. Do not list app/views.json or this skill in manifest.files.
Both HTML entries use the same local ./main.mjs module and ./style.css; navigate with declared relative HTML links and the normal host tabs. No external dependencies, bare module imports, fetch, credentials or invented SDK methods.
Use the actual window.riffoid API: readFile('docs/series.json') resolves an object with text; listArtifacts(cursor) returns items/nextCursor; readArtifact(artifactId,offset) returns receipt/offset/base64/nextOffset; subscribe(listener) resolves an unsubscribe function. These APIs are read-only. Read saved data through readFile, not network fetch.
Data is {version:'V1' or 'V2',series:[numbers],artifactId:actual tool-output artifact id}. Show its version, a factor number input initially2, and sum(series)*factor. Both pages must show factor2 and factor5 results correctly. Include Pause/Resume for input-driven updates and a browser-local/unverified label. A fresh frame restores factor2 from saved source, not unsaved JavaScript memory.
Subscribe once to current-package snapshots, display the observed revision/package identity, and cancel that subscription on pagehide. Never create canonical writes or tool/model calls from the page.
Provide an explicit artifact-check button. Copy the following readCheckedArtifact(api,id) reference verbatim into app/main.mjs and call await readCheckedArtifact(window.riffoid,data.artifactId) only on that button click. Display the returned actual receipt/artifactId, independently computed sha256, byte and chunk counts and contentPrefixVerified only after it resolves. On error display the error and stop that action; do not retry, fetch, regenerate an artifact or invent an SDK method. This helper's8-page and existing1114112-byte/16384-byte chunk bounds are local reference termination limits, not changes to server permissions. Artifact JSON body SHA is distinct from the source text SHA.

```javascript
// Reference for this future saved-page exercise; no network or retry implementation.
export async function readCheckedArtifact(api, id) {
  const MAX_BYTES = 1114112, CHUNK = 16384, MAX_PAGES = 8;
  const fail = code => { throw Error('artifact-check-' + code); };
  const digest = async bytes => [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))]
    .map(x => x.toString(16).padStart(2, '0')).join('');
  function checkedReceipt(r) {
    if (!r || r.schemaVersion !== 1 || r.artifactId !== id || r.operation !== 'read' ||
        r.mediaType !== 'application/json' || !Number.isSafeInteger(r.bytes) ||
        r.bytes <= CHUNK || r.bytes > MAX_BYTES || !/^[a-f0-9]{64}$/.test(r.sha256) ||
        !Number.isSafeInteger(r.createdAt) || r.createdAt < 1) fail('receipt');
    return {schemaVersion: 1, artifactId: id, operation: r.operation, mediaType: r.mediaType,
      bytes: r.bytes, sha256: r.sha256, createdAt: r.createdAt};
  }
  if (!/^artifact-[a-f0-9]{60}$/.test(id)) fail('id');
  let cursor = null, receipt;
  const seen = new Set();
  for (let pageCount = 0; pageCount < MAX_PAGES; pageCount++) {
    const page = await api.listArtifacts(cursor);
    if (!page || !Array.isArray(page.items) ||
        !(page.nextCursor === null || typeof page.nextCursor === 'string' && page.nextCursor)) fail('page');
    const found = page.items.filter(r => r.artifactId === id);
    if (found.length > 1) fail('duplicate');
    if (found.length) { receipt = checkedReceipt(found[0]); break; }
    if (page.nextCursor === null) fail('missing');
    if (seen.has(page.nextCursor)) fail('cursor-cycle');
    seen.add(page.nextCursor);
    cursor = page.nextCursor; // The returned opaque cursor is passed back unchanged.
  }
  if (!receipt) fail('page-limit');
  const expected = JSON.stringify(receipt), bytes = new Uint8Array(receipt.bytes);
  let offset = 0, chunks = 0;
  while (offset < bytes.length) {
    if (chunks >= Math.ceil(receipt.bytes / CHUNK)) fail('chunk-limit');
    const part = await api.readArtifact(id, offset);
    if (!part || part.offset !== offset || JSON.stringify(checkedReceipt(part.receipt)) !== expected ||
        typeof part.base64 !== 'string' || part.base64.length > 21848) fail('chunk-binding');
    const chunk = Uint8Array.from(atob(part.base64), c => c.charCodeAt(0));
    const end = offset + chunk.length;
    if (chunk.length !== Math.min(CHUNK, bytes.length - offset) ||
        part.nextOffset !== (end === bytes.length ? null : end)) fail('chunk-range');
    bytes.set(chunk, offset);
    offset = end;
    chunks++;
  }
  const sha256 = await digest(bytes); // Hash the joined original bytes before parsing JSON.
  if (sha256 !== receipt.sha256) fail('body-sha256');
  const envelope = JSON.parse(new TextDecoder('utf-8', {fatal: true}).decode(bytes));
  if (!envelope || envelope.kind !== 'read' || envelope.path !== 'docs/native-artifact-probe.txt' ||
      typeof envelope.content !== 'string' || !envelope.content.startsWith('native-artifact-probe-v1\n') ||
      envelope.bytes !== 17408 || new TextEncoder().encode(envelope.content).length !== envelope.bytes) fail('content');
  return {receipt, bytes: bytes.length, chunks, sha256, contentPrefixVerified: true};
}
```
For a revision update, preserve manifest, both pages, module, CSS, this skill and artifactId; only change docs/series.json version/series as requested. End normally so the platform commits this Turn's canonical files and Session checkpoint; do not invent a save API.
