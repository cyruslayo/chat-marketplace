# Two-up comparison from results

Status: ready-for-agent
Type: task
Blocked by: 11, 09
Parent: [13](13-thread-control.md)

## What to build

Let the guest pick two results and open a comparison of the All-In Stay Total, capacity and amenities, stacked vertically at narrow widths. Build it from Basic Catalog components in `discovery-a2ui.ts`.

## Acceptance criteria

AC numbers are kept from the parent issue for traceability.

- AC2: Choosing Compare on two results shows price, capacity and amenities aligned.
- AC3: At 320px, the comparison stacks attributes vertically with no horizontal scroll.

## ADR compliance

| ADR | Constraint |
|---|---|
| 0078 | Comparison stacks vertically at narrow widths |

## Definition of Done

- [ ] Every AC has one named test (name mirrors the criterion) and named failure paths are asserted.
- [ ] Relevant ADRs were re-read and mapped above; non-obvious constraints cited at the callsite.
- [ ] No invented policy strings: guest-facing wording for money/legal states traces to CONTEXT.md or an ADR; gaps raised with the user.
- [ ] No bearer credentials or contact values in telemetry or logs (ADR 0075).
- [ ] `npm run check` and `npm test` pass.
