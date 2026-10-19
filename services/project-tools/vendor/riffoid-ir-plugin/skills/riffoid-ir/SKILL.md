---
name: riffoid-ir
description: Build and revise Business IR models, extend IR domain packs and their compiler/browser support, and run supported models in the user's browser. Use for IR simulation, existing aircraft IR models, or requests to develop missing domain capabilities.
---

The model is `model/business-ir.draft.json`. New projects default to code;
`/sim ir`, `/sim code`, `/sim show` persist/query the project default. An explicit
request overrides the default, and existing model files determine their type.
Changing the default never converts a model.

For B1, read [the example](../../acceptance/b1/business-ir.json) and
[the supported fields](../../docs/model-fields.md). Copy and edit the JSON with
the host file tools. Show the current objects, tasks, resources, parameters,
rules and assumptions with file paths/Business IDs. Do not run when asked only
to generate or review. Do not treat the saved fingerprint as valid after editing.

Use these actual tools in order when execution is requested:

1. `project_ir_check({draftRef:"model/business-ir.draft.json"})` seals and validates.
2. `project_ir_compile({sealedRef})` compiles and inspects the saved sealed model.
3. `project_ir_run({browserArtifactRef})` creates a run for the connected browser.
4. `project_ir_result({runId})` reads its persisted state, metrics and events.

Use the returned references. `accepted`, `pending`, `running` are not success.
The user must open the IR Model panel or its local browser page; missing browser,
unsupported Plan and interrupted execution have explicit diagnostics. A normal
authorized workflow continues through readback without repeated confirmations.

Explain observations using the actual runId and event sequence/time/Business
source mapping. Separate inference from observed events. Browser results are
local/unverified, not a Verified Experiment.

Business edits (including the second mission's firstWaveTime) go into the draft,
followed by check and compile and a new run. `runOptions` permits only `seed`;
it cannot override business parameters. Compare two saved runIds. Old records
retain their models, Plans, runtime and inputs. To replay an old run, call
`project_ir_run({sourceRunId})`; do not recompile the current draft for a replay.

The installed browser runtime executes daily support through 7 days and
flight-exposure exponential failure with fixed repair, in addition to the B1
subset of legacy-minute-v1. It does not assign sorties to specific tails, and
it does not execute calendar-time failures, non-exponential distributions,
multi-aircraft waves, preventive maintenance, spares, or transport. Unsupported
semantics must be diagnosed before execution, never silently discarded. The
independent expected fixture is test evidence only; never use it to supply
simulation output.

When the user asks to extend the IR pack or add unsupported behavior (for
example MTBF/MTTR or multi-day missions), continue with domain-pack development
using the host's read/edit/bash tools, including in IR mode. Read
[the development guide](../../docs/domain-development.md). Inspect the actual
model, compiler and runtime; implement the missing layers, validate them and
return to the requested model. The initial B1 acceptance scope is not a ban on
later user-requested work. A request phrased as a question, such as “可以扩展 IR
包吗”, should lead to inspection and useful progress, not a blanket refusal or
a switch to unrelated code simulation.

Ask for missing business parameters that affect results, such as MTBF/MTTR
values, units and failure-clock assumptions, while progressing independent
development. A proposal-only request stays a proposal. If the host actually
denies source access or cannot load an updated package, identify that concrete
limit and prepare the patch or handoff within the accessible workspace. Adding
unconsumed JSON fields or disabling a capability check does not implement a
feature.
