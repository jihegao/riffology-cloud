# Workspace native controller boundary

The controller freezes the physical actor, paired lease, binding identity, execution deadline and optional prior committed archive/Session reference. Its caller must validate current paired Workspace authority before forwarding RPCs. `claimNativeStart` must reject a false or unknown paired native claim; it is invoked before the first SDK operation and its durable pending state is never replayed after an unknown response.

Each SDK operation has a binding-local durable intent. Controller reconstruction during an outstanding operation quarantines the binding instead of dispatching concurrently. A missing container cannot be restarted to read an old result. Destruction quarantines first and never starts a native seal helper; callers still retain the capacity guard for delayed SDK delivery. Ordinary checkpoint sealing requires the native whole-UID receipt, never just parent process exit.

Project preparation is stage → restore or strictly proven adopt → native activate → Durable Object active. A sealed activation replay is not runnable. The archive adapter uses a logical per-Turn identifier internally only after physical actor binding validation; tool capabilities are verified against the physical actor. Historical preparation and effect fences live in separate binding namespaces.

TrustedPi clears the previous token's known Session/control files before new Session staging. Starting uses the fixed supervisor/host command once. Before terminal status is exposed, `beforeSeal` must close Workspace outbound and model/money/tool dispatch ledgers, then native sealing must prove the dedicated UID empty. An unknown closure cannot produce a quiet receipt. Cancellation remains retirement-only even if a final Session can be read for audit.

The coordinator commits the frozen files and Session before invoking prune or authorizing handoff. Prune alone does not prove that remote commit. Unknown SDK metadata and logs are outside native token-file cleanup; bounded bindings and whole-container retirement remain required.

This adapter requires the same pinned runtime image revision as Project staging/preparation and Pi reset native protocols. Unit tests use real SQLite with simulated SDK transport; the Workerd test verifies actual Durable Object persistence and reconstruction with simulated transport. They do not certify the target Sandbox image/kernel or full runtime reuse. Native Linux primitive tests are separate; deployment and target-image acceptance remain gated.
