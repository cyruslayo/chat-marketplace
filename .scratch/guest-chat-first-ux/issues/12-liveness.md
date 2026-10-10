# Liveness: typing indicator, timeout, retry

Status: ready-for-agent
Type: task
Blocked by: 05
Findings: F12 (see ../PRD.md)

## What to build

Show a typing indicator while a turn is pending. Add a fetch timeout, and on failure show a Retry control that re-sends the same idempotent turn and keeps the draft text.

## Acceptance criteria

- AC1: A pending turn shows an indicator that is announced once.
- AC2: A turn that times out shows Retry and keeps the text.
- AC3: Retrying a command event does not create a second Booking Request.

## ADR compliance

| ADR | Constraint |
|---|---|
| 0079 | Retry never repeats a committed command |
| 0070–0072 | Duplicate events are deduplicated server-side |

## Definition of Done

- [ ] Every AC has one named test (name mirrors the criterion) and named failure paths are asserted.
- [ ] Relevant ADRs were re-read and mapped above; non-obvious constraints cited at the callsite.
- [ ] No invented policy strings: guest-facing wording for money/legal states traces to CONTEXT.md or an ADR; gaps raised with the user.
- [ ] No bearer credentials or contact values in telemetry or logs (ADR 0075).
- [ ] `npm run check` and `npm test` pass.
