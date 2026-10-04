# Servicing schedule and maintenance requests during an Extended Stay

Status: ready-for-agent
Type: task
Blocked by: 05, 06

## What to build

A long stay must stay livable, and that must be visible.

- From the unit's cleaning frequency (issue 05), generate a cleaning schedule for the stay and show it to the guest and the back office.
- The guest can report a maintenance problem from the stay page or chat. It creates a record in the existing incident path (`mid-stay-failure.ts`), classified under ADR 0061: safety, access or habitability; essential amenity; advertised amenity; or minor.
  - Power, water and internet failures that the unit's utilities statement says are included count as amenity failures under ADR 0061.
- Remedies, cure windows and percentages are exactly ADR 0061's, using the nightly contracted values from issue 05. Nothing new is invented here.

## Acceptance criteria

- AC1: An Extended Stay shows a cleaning schedule derived from the unit's cleaning frequency, and changing the unit's frequency later does not change a confirmed stay's schedule.
- AC2: A guest-reported maintenance problem creates one incident record linked to the stay, classified under ADR 0061.
- AC3: An included utility reported as failed is treated as an amenity failure with ADR 0061's cure window and remedy, calculated on that night's contracted value.
- AC4: A maintenance report from someone other than the stay's Primary Guest is refused.

## ADR compliance

| ADR | Constraint |
|---|---|
| 0061 | Severity-based remedies on nightly contracted value |
| 0030 | Incidents converge on one auditable record |
| 0092 | "Servicing and failures"; utilities included |

## Definition of Done

See `docs/agents/issue-tracker.md`.

## Comments
