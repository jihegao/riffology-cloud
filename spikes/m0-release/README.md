# G0-T10 local release compatibility and rollback primitives

This probe starts real independent Node child processes and performs real file writes. It is a local controller/runtime fixture, **not a Cloudflare Worker deployment, Container rollout, cloud release attestation, or G0 pass**. No Docker, Wrangler, internet, model, or paid service is needed. It changes no product API.

Run from the repository root:

```sh
node --test spikes/m0-release/release.test.ts
npm run typecheck
```

The tests create unique temporary directories, kill only their own child processes, wait for child closure, and delete only those test directories. Test assertions include real child PIDs, independent reads of actual effect/checkpoint files, controller-side dispatch counts and failed admission states. There is no always-success fake runtime adapter.

## Interface and authority

`ReleaseController` in `controller.ts` is the local adapter for the Worker-side policy role. `policy.ts` fixes controller release `controller-v2`, allowed runtime releases `runtime-v1` and `runtime-v2`, protocol `m0-v1`, checkpoint manifest format 1, and the runtime source SHA-256. The two synthetic releases use the same pinned fixture program with different fixed launch arguments; this is not evidence of two real container/image builds.

| Method | Purpose |
|---|---|
| `initialize()` | Opens the local controller checkpoint store |
| `startTask(id, { release?, restore?, fault? })` | Pins the chosen release, verifies source digest, copies those verified bytes to a fresh launch file, optionally verifies/restores the confirmed checkpoint, then spawns the runtime and validates its handshake |
| `activate(release, fault?)` | Checks a candidate using a separate real process; admits it before changing the local active pointer; failed candidates retain the prior pointer and record `rollback` |
| `execute(task, requestId, command)` | Dispatches only fixed `increment` or `read-state` after handshake; completed identical retries return the recorded result without dispatch |
| `checkpoint(task)` | Reads the fixed state file from a ready runtime and saves a verified manifest/blob graph through the existing pure checkpoint protocol |
| `confirmedCheckpoint()` / `view(task)` | Returns controller-owned confirmation or launch/dispatch metadata |
| `stopTask(task)` / `close()` | Stops and awaits only owned child processes |

No task can choose an arbitrary executable, command, source file, network destination, checkpoint revision or shell expression. Task/request IDs are bounded. Fault injection is an enumerated test-only launch option: unknown protocol, unknown checkpoint format, release mismatch, startup exit, or write-side-effect followed by exit before its response.

The launcher selects the release, checks a checked-in SHA-256 pin, snapshots those verified runtime bytes before spawning with a minimal empty environment, and retains the actual child-process handle. IPC handshake fields are negotiation claims which must agree with that launcher record and the fixed allowlist. Project stdout explicitly prints a false `admitted=true` claim in every healthy launch; it is discarded, and rejected handshakes still dispatch zero application commands. Neither stdout nor a self-reported release alone establishes trusted identity. This is local measured fixture provenance, not signed remote attestation or an OS security boundary against arbitrary hostile code running as the same user.

## What the tests establish

1. A newer controller actually handshakes with the older compatible runtime and runs a fixed command. A command attempted before admission is refused.
2. Unknown protocol/format and a mismatched release reject real started runtime processes; controller dispatch count and actual effect files show zero application-command execution. Startup code necessarily ran to produce a handshake; zero execution here does not mean zero startup instructions.
3. A process that exits during startup cannot leave a `running` task, and its PID is no longer alive when the failure returns.
4. Existing tasks keep their immutable launch release while tasks created after successful activation use the new release.
5. A failed candidate restores/retains the previous local selection. A fresh runtime reads the prior confirmed checkpoint after every object and the manifest digest are checked; the restored state bytes exactly match the confirmed SHA-256.
6. An actual file effect followed by a process crash is `unknown`, never a fabricated success or safe-to-retry failure. The same request ID cannot dispatch again, and an unknown task cannot checkpoint or accept another command. Existing task directories cannot be reused after a controller restart when its in-memory request ledger is unavailable. A new recovery task starts only from the previously confirmed checkpoint, excluding the unconfirmed effect.
7. Corrupted checkpoint bytes and an unapproved artifact digest fail closed; corruption is rejected before a child is spawned.
8. Stop waits for an in-flight startup to settle; cancelled startup cannot later spawn or become ready. Stop before the checkpoint's atomic head switch prevents that switch, and a late command response cannot revive a stopped task. Checkpoint authorization and the local atomic head rename occur without an intervening await; a checkpoint already committed before stop remains confirmed.

## Limits

The local active pointer and request ledger are in memory. Fresh task-directory creation prevents automatic reuse of an old task identity after restart, but this is not production durable idempotency, process adoption, a multi-controller lock, power-loss durability, or reconciliation of arbitrary external side effects. The file checkpoint store uses an atomic local head rename and the existing digest validation functions; it does not prove R2/DO ordering, replication, or fsync/power-failure guarantees. Domain counter values are synthetic fixture behavior, not validated model results.

`activate` validates a candidate before selecting it; its `rollback` is a real local pointer-retention/fallback primitive, not cloud traffic rollback after a partial rollout. Cloud mixed Worker/image windows, actual image startup failure, live routing, release manifests and remote deployed digest verification, interrupted rolling updates, cloud rollback and cloud checkpoint recovery all remain `not_run`. These local tests leave G0-T10 `not_evaluated`.
