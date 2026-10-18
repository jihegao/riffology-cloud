# Aircraft B1 modelling fields

The editable envelope uses `aircraft-business-ir/v1` and `payload.semantic_profile`
`legacy-minute-v1`. The compiler owns the fingerprint. Copy the B1 fixture, edit
its payload, then call check; stale fingerprints are explicitly resealed.

| Meaning | JSON path under `/payload/sections` | Business ID |
| --- | --- | --- |
| Aircraft and initial state | `aircraft/collections/assets/*/definition` | tail number |
| Mission duration, notice, success point | `mission_profile/collections/basic_missions/*/definition` | basic-sortie |
| Departure times | `mission_profile/collections/composite_tasks/0/definition/taskItems/*/firstWaveTime` | sortie-a, sortie-b |
| Support durations and resource requirements | `support_activities/collections/activities/*/definition/jobs/*` | f35-daily-preflight, f35-daily-postflight |
| Personnel/equipment capacity | `support_network/collections/nodes/*/definition` | flight-line |
| Horizon | `time/properties/duration_minutes`, `mission_profile/properties/duration_minutes`, `stop_policy/properties/conditions` | simulation |
| Calendar days | `mission_profile/collections/mission_calendar/*/definition/day_index` | day 1–7 |
| Same-day repeats | `mission_profile/collections/composite_tasks/0/definition/taskItems/*/dailyRepeatCount` and `intervalHours` | task item |
| Exponential failure rate | `equipment_tree/collections/components/*/definition/failure_distribution` | component id |
| Fixed repair duration | `equipment_tree/collections/components/*/definition/special_repair_profile/repairTimeMinutes` plus a `repair` activity | component id |
| Seed | `$root/properties/seed` | simulation |

The browser runtime supports daily operations through 7 days (10080 minutes),
serial support, personnel/equipment reservations, mission notice/dispatch/
cancellation/success/return, cross-day postflight, and flight-exposure
exponential failure with a fixed repair duration. The compiled Plan determines
event timing. The failure clock advances only while the aircraft is flying, and
the browser samples the compiled hourly rate exponentially; it does not execute
Weibull, normal, uniform, or calendar-time distributions. There is no per-tail
assignment field: a repeated task is a fleet wave, not a guaranteed sortie for
each aircraft. Preventive maintenance, spares, transport, multi-aircraft waves,
and natural completion remain rejected before dispatch.

These are current execution capabilities, not a restriction on domain-pack
development. For requested capabilities beyond this subset, use the host's
development tools and follow [domain development](domain-development.md), then
return to the model after implementing and validating the missing semantics.

Baseline: two aircraft, two 10-minute missions at 20 and 40, 3-minute preflight,
zero-step relaunch, 2-minute postflight, one crew and cart, horizon 60, seed 0.
The required variant changes only taskItems/1/firstWaveTime to `00:45`.
