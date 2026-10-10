# Journey rail and back to results

Status: ready-for-agent
Type: task
Blocked by: 04a
Findings: F5 (see ../PRD.md)

## What to build

Add a compact rail (Search → Stay → Request → Offer → Pay → Confirmed) derived from the workflow projection, including failure and expiry states. From stay detail, allow going back to the results for the same search, which removes the linear-demo limitation at `guest-server.ts:898`.

## Acceptance criteria

- AC1: The rail's current stage matches the server projection after every event and after reload.
- AC2: Expired and declined states show on the rail as themselves, not as progress.
- AC3: "Back to results" from stay detail restores the previous results with the same criteria.
- AC4: Going back never cancels a submitted Booking Request.

## ADR compliance

| ADR | Constraint |
|---|---|
| 0005 | Stages mirror request-to-book projections |
| 0079 | Recovery restores the stage without restarting work |

## Definition of Done

- [ ] Every AC has one named test (name mirrors the criterion) and named failure paths are asserted.
- [ ] Relevant ADRs were re-read and mapped above; non-obvious constraints cited at the callsite.
- [ ] No invented policy strings: guest-facing wording for money/legal states traces to CONTEXT.md or an ADR; gaps raised with the user.
- [ ] No bearer credentials or contact values in telemetry or logs (ADR 0075).
- [ ] `npm run check` and `npm test` pass.
