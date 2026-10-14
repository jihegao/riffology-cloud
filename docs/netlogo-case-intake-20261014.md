# NetLogo Fire local candidate intake — 2026-10-14

This intake is the local engineering scope of [#196](https://github.com/jihegao/riffology-cloud/issues/196), related to [official-model publication #35](https://github.com/jihegao/riffology-cloud/issues/35). It does not publish an official model or satisfy the first Queue / Inventory / Maintenance ordinary-user acceptance. The existing publication implementation from [PR #60](https://github.com/jihegao/riffology-cloud/pull/60) is reused as the eventual publication path.

## Frozen source and reuse boundary

The source library is [simulation-case-library at `05bcb541`](https://github.com/jihegao/simulation-case-library/tree/05bcb541846356fb94326cc79bb6236da6e85e10). Its [five-case catalog](https://github.com/jihegao/simulation-case-library/blob/05bcb541846356fb94326cc79bb6236da6e85e10/catalog/README.md) contains Fire, Segregation, Wolf Sheep Predation, Traffic Basic and Virus on a Network. All remain candidates; historical native observations, partial independent replay, cross-implementation checks and research/gold acceptance retain their separate boundaries.

Fire is the selected first adaptation. Its source is the external NetLogo 7.0.4 model `models/Sample Models/Earth Science/Fire.nlogox`, SHA-256 `0a2420e463481fb2cd7791aacdc068735db0d900c14d3fece0a93a085246b171`. A read-only examination of the installed pinned source established the following mechanism contract:

- Setup randomly places trees, unconditionally ignites the entire leftmost column, then counts the remaining green patches as `initial-trees` and resets `burned-trees` to zero.
- A tick processes the fires present at the start of that tick. They ignite green north/east/south/west neighbors in a non-wrapping world; newly created fires do not advance again in the same tick.
- Ignition increases the cumulative burned-tree count. Old fires become embers, which fade and eventually disappear. NetLogo stops when there are no turtles, including embers, rather than immediately when there are no active fires.
- NetLogo `ask` iteration and its random stream differ from Python. An equal integer seed does not establish equal initial trees or per-tick numerical outputs across the two runtimes.

The library's reviewed historical observation has `initial-trees=541`, `burned-trees=0`, `count fires=31` at tick 0 and `541`, `59`, `7` at tick 5. These are externally produced reference observations for the frozen native recipe, not expected values for Python's random initialization and not Riffoid Run receipts.

## License and model identity

Wilensky, U. (1997). NetLogo Fire model. Center for Connected Learning and Computer-Based Modeling, Northwestern University. [Official model information and license](https://ccl.northwestern.edu/netlogo/models/Fire).

The source model is licensed under CC BY-NC-SA 3.0; commercial licenses are separately available. The Python adaptation retains attribution and the same license. The original NetLogo model body and runtime are not included. This candidate is delivered in the private repository for local evaluation; it does not assert permission for public or commercial distribution. Changing the implementation language does not remove the upstream license conditions. The canonical platform adapter retains its platform provenance.

## Existing runtime and publication contract

The candidate uses the current five-file Python model contract, `python-stdlib/v1`, the unchanged canonical `model/run.py` adapter and `riffology.visual/v0.1`. Model-authored Python Canvas drawing distinguishes healthy trees, active fire and burned cells; the generic grid renderer is unsuitable because it does not assign distinct colors to these states.

The canonical adapter independently recomputes model output under the caller's local process. Its `summary.json` selects declared final metrics. Its existing `trace-audit.json` contains Queue-oriented generic columns; it is not a Fire-specific propagation audit. Candidate semantic checks inspect the complete local trace separately. No production Revision, Run, Experiment, R2 package or authenticated publication identity is manufactured by local tests.

An eventual official version must be created through a normal authenticated author project, saved as a real Revision, independently executed for baseline/intervention evidence, submitted, reviewed by a non-author, frozen and published, then copied and run by a new user. A repository example is a development candidate, not a replacement for that flow. Browser results remain **local/unverified**.

Actual local checks, source digests, review findings and remaining gaps are recorded in [the local evidence receipt](evidence/netlogo-fire-candidate-local-20261014.json). Scope and completion are tracked in #196 and its PR; #35 retains its full ordinary-user publication scope.
