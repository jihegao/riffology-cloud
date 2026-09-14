# Direct experiment comparison

The workspace Compare panel reads saved `/model` and `/experiment-groups` resources. A baseline and one to three interventions expose the Model Spec's integer, number, enum and boolean controls. Defaults come from that same saved Spec. A hypothesis, distinct configuration labels and one to twenty unique uint32 seeds form a comparison. Each configuration runs once per seed; the form displays repetitions and total Run count. Parameter experiments do not invoke the Agent or write model files.

The existing single-Run Simulation panel remains available. The Compare module is `services/web/comparison.js`, mounted and disposed alongside the workspace's other panels. The gateway serves that exact static module. `check:ui` checks its syntax.

## Request identity and recovery

Before POST, the panel saves `{key, body}` in workspace/tenant-scoped session storage. Failure to persist prevents submission. The body includes the saved revision ID and file/Spec hashes, hypothesis, baseline/intervention parameter maps and seed list. While delivery is uncertain the editor is frozen and the exact request can be inspected. Refresh and reopen issue GET requests only; explicit retry sends the original key/body even if the current model changed. A successful response clears the stored intent. Known preacceptance validation/stale/size errors clear the rejected intent and require refreshing the model. Network errors, unavailable service, capacity responses and ambiguous conflicts retain it. A draft whose model content hashes change on explicit refresh is reset to the new model defaults with a visible notice.

## Results and limits

The history displays group status/progress, stale-model notices, admission/reconciliation errors and per-configuration metric count, missing count, mean, baseline mean and difference. These values come from the backend; the UI does not invent confidence intervals or recalculate results. The current backend computes each configuration's mean from its completed valid runs, so missing runs can yield unequal seed samples. The table labels the difference of these means and warns for partial/failed/cancelled groups; it does not present a matched-pair estimate or scientific validity certification.

Every child Run has an expandable record containing its group version, configuration parameters, seed, status, error, persisted result/artifact digest and release flag. Pending children may have a reserved Run ID before a standalone Run exists, so the UI uses these group records rather than broken standalone links. Cancel requests use the group cancel endpoint; refreshing never resubmits experiment work. History follows `nextCursor` explicitly and active groups poll their detail endpoints. Polls update history only, preserving focus and unsent editor values.

## Local acceptance

Chrome tests cover all four parameter types, exact-key/body retry after workspace reentry and model change, confirmed rejection, seed validation, defaults, missing samples, stale results, raw evidence, cancel, pagination and focused draft preservation while polling. The actual module and CSS are visually inspected at 1280px desktop and 390px mobile widths. Existing application and single-Run browser suites retain explicit fixture routes for the new read endpoints. This is local UI acceptance; it does not replace a real project/runtime or production acceptance.

When the evidence service returns a Run's `evidenceRejection` and `progress.rejected`, the panel displays the persisted rejection reason and assessment identity without changing execution status. The group backend excludes rejected Runs from its summary; the panel explains this exclusion separately from failed or cancelled execution.
