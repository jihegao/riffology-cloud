# Compiler v0.1 authoring

Riffology's compiler route stores the editable aircraft Business IR and the
compiled model bundle in one Revision:

- `model/business-ir.json` is the sealed Business IR used for compilation.
- `model/model.simpack` is the bundle produced by `sim-engine compile`.
- `model/model-spec.json` declares the compiler route and numeric result
  metrics exposed by the product.

The public `sim-engine example DIRECTORY` command writes a B1 `business.json`
and reference bundle to a new scratch directory. Its Business file can guide
the draft structure. The Agent must edit the draft for the user's model and
compile that edited source; the reference bundle is not the submitted model.
Only the Agent-created scratch copy is removed before saving the Revision.

The Agent keeps edits in `model/business-ir.draft.json` and runs the installed
public CLI through the bounded `project_bash` tool:

```sh
sim-engine seal model/business-ir.draft.json model/business-ir.json
sim-engine validate model/business-ir.json
sim-engine compile model/business-ir.json model/model.simpack
sim-engine inspect model/model.simpack
```

Every Business payload change requires a new seal, validation, and compilation.
The Agent must keep diagnostic output and must not create or edit `.simpack`
bytes directly. Package internals and compiler repository scripts are outside
the product contract.

The Model Spec uses this execution object:

```json
{
  "kind": "compiler-v01",
  "businessIr": "model/business-ir.json",
  "bundle": "model/model.simpack"
}
```

The Model Spec uses an empty `parameters` object. Its metric keys map to finite
numeric values from the compiler result. The string `stop_reason` is recorded
as run metadata rather than a numeric metric. Business parameters are compiled
into the bundle; changing one creates a new Business IR and bundle.

Seal, validate, compile, and inspect are local authoring checks inside Project
Tools. They do not create a cloud Run, persisted result, Verified Experiment,
Evidence, deployment, or release acceptance. Cloud execution begins from the
saved Revision and consumes its frozen bundle.

The Project Tools image installs `sim-engine-compiler==0.1.0` from the reviewed
wheel with SHA-256
`e7bcd9271dd42106b78e87176e3485b290536f5291c0440872b814fc549858f7`.
It runs in an isolated CPython 3.14.2 environment with SimPy 4.1.1; the
platform helper interpreter remains separate.
