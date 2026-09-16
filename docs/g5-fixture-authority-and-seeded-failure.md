# G5-A proposal B: same-Turn seeded failure

The same-Turn repair contract is retained by the authorized B2 fixture. The prior reviewed Proposal-B bytes had SHA-256 `c31c76ec54074f59d9aacc834b2641ce8e130637834dd8cf8e6e8927c9961bad`; B2 adds measurable boundary inputs and the bounded trace-audit output, producing fixture SHA-256 `673d0cbe930990602649aaa9d746e16ad29280981f5f7be336b368388ceee753`. This document does not grant live execution authority, and no cloud service was changed by the local fixture update.

Proposal B keeps three Projects, 18 ordinary-user Turns, 39 Runs, three group intents and `normalAdmissionTasks=63`. Exactly `probeTasks=3` are reserved, so `maximumAdmissionTasks=63+3=66`. It does not change the 147-dispatch cap, US$20 window cap, US$5 Turn cap, concurrency one or two-hour admission deadline.

The repair prompt is 6,437 UTF-8 bytes, below the product's 16,000-character Turn limit. It contains the frozen failing bytes but does not contain the reference repair bytes. It instructs exactly six Tool Sandbox calls and prohibits all others:

1. `project_bash` decodes the frozen failure base64, checks SHA-256, then atomically replaces `model/model.py`.
2. `project_read` confirms the failed file SHA-256.
3. `project_bash` prints the source digest and runs Python compilation, retaining the nonzero child exit and `SyntaxError` stderr in the Tool Ledger result.
4. `project_bash` requires the failure SHA-256, replaces the single exact UTF-8 line `def run(config)\n` with `def run(config):\n`, changes no other bytes, checks the expected repair SHA-256, then atomically replaces the file.
5. `project_read` confirms the repaired file SHA-256.
6. `project_bash` prints the repaired digest and requires Python compilation to exit zero.

The platform represents a nonzero child process as a completed `project_bash` tool effect whose structured result contains `exitCode` and `stderr`. Thus the public `tool.completed` event is not itself an error and does not expose the result. Proposal B does not claim a failed Revision or failed Tool Artifact. Acceptance requires a private authority adapter to read the full Tool Ledger, bind six unique command/effect/event identities to the repair Turn, hash each terminal result receipt, verify the exact failure and repair file digests, verify nonzero/SyntaxError then zero compile results, and confirm the final saved Revision restores the predecessor's source/spec digests under a new Revision ID.

`g5-fixture-authority.mjs` defines that fail-closed contract. It also enforces global fixture order, exact `dependsOn` authority receipts, Workspace/Session/Turn identity, source relationships, and one authoritative reference for every named evidence and domain check. The module reports `executable:false` and `authorized:false` because no production adapter currently implements `inspectFixtureTask` from private Tool Ledger and Turn-event state.

Stage one can prove the saved Revision/source relation, settled three-ledger state, ordered Tool facts and repair receipt chain. Stage two can prove exact Run ordinals and inputs, Group ownership and parent Turn, child release state, and creator/metric/coverage-bound claims. It still returns `accepted:false` for current manifest requirements that durable product state cannot prove: optional full-frame trace invariants; the create fixture's later paired-arrival comparison; unexecuted `max_wait=0`; unexecuted `queue_capacity=0`; generic validation/export identities; natural-language served-only meaning; and a bounded reopen/read interval with zero new Run/provider activity. No terminal receipt is stored and no successor fixture is admitted.

If the model issues a seventh tool call, changes order, omits a digest readback, produces an unknown tool outcome, cannot expose the complete private ledger, or fails to restore and save the repaired source, the repair fixture is rejected and no Run may start. Prompt text, assistant prose, fixture bytes and browser output cannot substitute for the six receipts.

The alternative first-class operator task remains possible, but it would require 64 normal tasks and reduce terminal probes to two. It is outside this proposal.
