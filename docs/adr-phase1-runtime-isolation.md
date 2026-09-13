# ADR: retain separate finite execution in Phase 1

Status: accepted for the local implementation; container reuse remains deferred under #37.

Each finite simulation uses an immutable source revision and a dedicated runtime identity. Pi and long-lived Preview services retain their existing lifecycles. A project cannot turn an uncertain execution into success or return capacity before stop and external release evidence are confirmed.

Keep this isolation for Phase 1. Reuse would require a separately reviewed reset protocol for project processes, files, network capabilities, input identity, dependency state, and delayed starts. It is not justified by cold-start speculation alone.

Measure queue, preparation, execution, and save durations from durable Turn timestamps/events. Missing retained event boundaries remain unknown. Record simulation created/updated/status timestamps and external capacity waits during cloud acceptance. Collect distributions across ordinary-user sessions and agree on a concrete user-visible latency target before promoting reuse to a release blocker. The current local tests establish correctness, not that production latency meets a target.

Preview and a parameter Run need concurrent tenant capacity. The explicit increase-only quota policy migration preserves existing leases, rejects an unexpected source version, and never discards unknown allocations. An active Preview may therefore coexist with a finite Run without bypassing accounting.
