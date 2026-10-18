This is a local synthetic compatibility check, not online ACC.
Both existing targeted tests run with M1_PROJECT_VIEW_BROWSER=webkit and the existing external WebKit2359 cache. No product, package, fixture or CSP source changed.
The opaque frame executes the original frozen classic Blob Worker, which dynamically imports the exact original frozen ESM runtime. The same shared page also executes the local PiWeb module Worker branch. Both saved B1 records report 2/2/2/2/0/0/60 and 22 browser events.
The opaque-frame test rejects a tampered runtime, invokes panel.leave and leaves no iframe or active Worker. The PiWeb module case leaves no active Worker; an explicit local pagehide cleanup probe observes detach before browser close.
Raw logs, local launcher paths and screenshots remain private. [EXISTING_WEBKIT_CACHE] and [EVIDENCE_HOME] are declared local-path placeholders. No current Safari or IAB tab was touched.
