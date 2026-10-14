# NetLogo Fire — local Riffoid candidate

Status: **local, private, unverified candidate** for [riffology-cloud #196](https://github.com/jihegao/riffology-cloud/issues/196). It is not the first official Queue/Inventory/Maintenance case in #35, is not in the production catalog, and has not passed native NetLogo replay, cross-implementation equivalence, publication, research, or gold admission.

The repository-level source/intake decision and the other reviewed cases are recorded in [`docs/netlogo-case-intake-20261014.md`](../../docs/netlogo-case-intake-20261014.md).

This directory packages a Python standard-library adaptation for the canonical Riffoid model contract and local Browser Preview. Browser Preview output is local/unverified and is never Verified Experiment/Evidence.

## Mechanism and metric timing

The world is a fixed, finite, non-wrapping 31×31 grid. Setup draws a tree independently for every cell, then ignites every cell on the left boundary even when it was initially empty. Only after that ignition does it record `initial_trees`; it then resets `burned_trees` to zero. Therefore the 31 forced left-edge fires appear in frame 0 but are excluded from both `initial_trees` and `burned_trees`.

Each tick freezes the current fire front, ignites green north/east/south/west neighbors, converts the old front to embers, fades every ember, then advances time. Newly ignited cells do not propagate until the following tick. Empty cells block spread, diagonal and wrapped neighbors are absent, and burned cells never recover. Runs continue while either fires or fading embers exist, up to the requested bounded `steps`.

`burn_fraction_pct` is `100 * burned_trees / initial_trees`, or `0` if the denominator is zero. `active_fires` corresponds to NetLogo `count fires`. `burned_trees` excludes the setup fires, exactly as the reviewed source's update order requires.

## Reproducibility boundary

The default `density_percent=57`, reference input seed `20261001`, and 31×31 world mirror the bounded case recorded by `simulation-case-library` at commit [`05bcb541`](https://github.com/jihegao/simulation-case-library/tree/05bcb541846356fb94326cc79bb6236da6e85e10/catalog). Seed is a required run input, not a Model Spec default. That catalog entry is itself `candidate`; its native CSVs are historical, finite evidence for the external NetLogo model. They are not evidence that this Python adaptation executed correctly and are not used as an exact oracle here.

Python `random.Random` and row-major initialization differ from NetLogo's RNG and agentset evaluation order. Equal seeds do not produce equal forests, so the historical tick-5 values `541 / 59 / 7` are intentionally not asserted for this implementation. Local tests cover the mapped mechanism and invariants instead.

See [docs/SOURCE_AND_LICENSE.md](docs/SOURCE_AND_LICENSE.md) for attribution, hashes, and CC BY-NC-SA 3.0 conditions.

## Local verification

From the repository root, run:

```sh
node --experimental-strip-types --test tests/m3/netlogo-fire-candidate.test.mjs
```

The test validates the real five-file archive with `validateSavedPreview`, checks the pinned platform adapter bytes, runs CPython through that adapter, validates the visual trace, exercises hand-derived boundary/neighbor/update cases, and checks deterministic replay and output bounds.

The Browser driver requires the repository's locked Node dependencies, Playwright Chromium, and prepared fixed Preview assets. From a clean checkout, prepare them without manifest/index update flags:

```sh
npm ci
node services/browser-preview/runtime/prepare-assets.mjs
node services/browser-preview/execution/materialize.mjs
node scripts/m3/materialize-browser-preview-web.mjs
```

Then run the real packaged candidate through Pyodide and capture local evidence with:

```sh
node --experimental-strip-types scripts/model/netlogo-fire-browser-local.mjs
```

The canonical adapter's `trace-audit.json` has queue-oriented columns retained for platform compatibility. For this Fire candidate, the adapter summary selects the declared Fire metrics; production authority would still require a real authorized server execution. Local tests may inspect the full in-memory trace, but the generic trace audit is not a complete Fire audit.
