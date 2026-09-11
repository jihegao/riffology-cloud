# Staging v3 storage reset

The staging Turn admission gate remains disabled while Revision v3 is validated.
This reset intentionally abandons prior staging users, projects, sessions, Turns,
Revisions, and generated artifacts. Model templates and release images are not
part of the user-data reset.

## Active resources from 2026-09-11

- D1: `riffology-catalog-staging-v3-20260911`
  (`f122099b-8eaa-4eca-83a0-755de0f8b46b`)
- Checkpoint R2: `riffology-workspace-checkpoints-staging-v3-20260911`
- Model-content R2: `riffology-m3-model-content-staging` (unchanged release input)

## Quarantined resources

These resources were detached from the staging Worker on 2026-09-11. They have
no product read path and must not be physically deleted before 2026-09-18.

- D1: `riffology-catalog-staging`
  (`993f2fd9-a135-4a93-9caa-10828dec6635`), 24 tables, 389120 bytes at inventory
- Checkpoint R2: `riffology-m1-workspace-checkpoints-staging`, 18 objects,
  385 kB at inventory

Before deletion, verify the live Worker bindings still reference only the active
resources, repeat the old object/table inventory, and record the deletion result.
The seven-day date is the earliest deletion date, not an automatic deletion job.
