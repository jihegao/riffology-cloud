# Persistent research workspace (#45 → #34)

The actual Gateway web application in `services/web` keeps the Agent and the model in one project workspace. Presentation preferences never submit a Turn, service run, or Experiment.

## Views over the same state

- Desktop widths from 1200px start at approximately 35% Agent / 65% model; 768–1199px keeps a narrower resizable Agent. Drag the separator or focus it and use Left/Right, Home/End. Tabs support arrow keys and Home/End.
- Below 768px, Chat / Preview switches between the same mounted panes. The project-scoped local preference stores pane ratio, depth, selected right view and mobile pane. It stores no model or execution identity.
- Explore opens Preview, with explicit **Run saved model / Stop**, the existing interactive iframe, parameters and the latest persisted result. Model shows the non-programmer Model Spec and the explicit reproducible export action. Experiment opens Runs, with baseline/interventions/seeds, persisted evidence claims and existing Run history. Inspect opens source Files/Diff and expandable interaction-run diagnostics; all depths share the original panel instances.
- Model versions and results remain authoritative API values. Direct parameter experiments use the existing simulation API and persist their effective parameters, seed and Run identity; the Agent continues to consume the existing persisted research context.

## Restoration and version transitions

Entering a project restores an existing Preview binding and redeems a fresh access ticket without executing the model. When no binding exists, an already-running service may be connected; a stopped service is not restarted. Preview binding/retry continues to use the existing CAS and durable idempotency protocol.

The displayed Preview pins the selected service used by the version label and Stop button, even when a different running service is first in the list. A newly saved model is identified as newer than the displayed Preview. Only explicit **Run saved model** admission changes the service selection and then rebinds the Preview. The old iframe is removed while the new explicit run is prepared so it cannot impersonate the new version. When the service stops, parameters, results and history remain visible; rerun is explicit.

Manual close is remembered in project-scoped session storage across refresh. It closes only the view and does not stop the service. Explicit recovery remains available. A failed Preview read or ticket request leaves a visible retry action; recovery is not suppressed by the service's already-notified marker. Healthy connected previews hide the redundant recovery button and place refresh under Preview options. Independent uses of the service/Preview modules retain their previous default behavior.

## Local validation evidence

`tests/m3/workspace-layout.test.mjs` loads the real app HTML/modules in installed Chrome, with intercepted authenticated API fixtures and a cross-origin iframe explicitly labelled **LOCAL UI FIXTURE**. It covers desktop default ratio, keyboard/drag, view/depth persistence, tablet split, mobile switching and refresh; mismatched running-service ordering; old/new model state; parameter rerun without any Turn POST; explicit rebind; Stop identity and retained results after reopen; manual close and failed-read recovery. Tests assert no unintended service/experiment executions on layout changes and restoration.

Screenshots are in [the local evidence directory](evidence/workspace-layout-local-20260914/): desktop Explore/Model/Experiment/Inspect, tablet, mobile Chat/Preview, old Preview with new model, and explicit new-model Preview. These images and fixtures demonstrate UI behavior only. They do **not** certify deployed state, a live simulation, paid model execution, cloud capacity release, or the complete research-loop acceptance. Those remain separate controlled acceptance records.

Related compatibility suites: `tests/m1/web.test.mjs`, `tests/m3/service-panel.test.mjs`, `tests/m3/preview-panel.test.mjs`, `tests/m3/simulation-ui.test.mjs`. They retain authorization, disabled/maintenance projects, unknown mutation response retry, history recovery and standalone panel checks. Release candidates additionally run the repository's full `npm run check`.
