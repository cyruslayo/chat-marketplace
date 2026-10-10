# Conventional booking pages with owner checks

Status: ready-for-agent
Type: task
Blocked by: 06a
Parent: [06](06-conventional-routes.md)

## What to build

Serve owner-checked pages for `/booking-requests/:id`, `/booking-requests/drafts/:id`, `/conditional-offers/:id` and `/booking-contracts/:id`, using the `getConventional*View` functions (`apps/web/src/presentation.ts:125–158`). These routes must not inherit the session exemption that `guest-server.ts:2002` gives to `/stays/*`.

## Acceptance criteria

AC numbers are kept from the parent issue for traceability.

- AC4: A route for someone else's draft or offer fails closed.
- AC1 (booking part): each booking conventionalRoute the guest app emits returns 200 for its owner.

## ADR compliance

| ADR | Constraint |
|---|---|
| 0080 as modified by 0081 | Material workflows have conventional route parity |
| 0070–0072 | Routes re-authorize and version-check commands |

## Definition of Done

- [ ] Every AC has one named test (name mirrors the criterion) and named failure paths are asserted.
- [ ] Relevant ADRs were re-read and mapped above; non-obvious constraints cited at the callsite.
- [ ] No invented policy strings: guest-facing wording for money/legal states traces to CONTEXT.md or an ADR; gaps raised with the user.
- [ ] No bearer credentials or contact values in telemetry or logs (ADR 0075).
- [ ] `npm run check` and `npm test` pass.

## Comments
- 28 Sept 2026: the audit for launch-readiness issue 10 found this work implemented and tested on main, but this file was never set to resolved. The status is left for a human to confirm against the Definition of Done.
