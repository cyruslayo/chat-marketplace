# Stop inventing dates; parse and confirm relative dates

Status: ready-for-agent
Type: task
Blocked by: 07
Findings: F2, F3 (see ../PRD.md)

## What to build

Replace the fixed `demoCheckIn` in `apps/local-guest/src/concierge.ts:316` with real date understanding. Handle explicit dates ("26 Sept", "26–28 Sept"), relative phrases ("tonight", "tomorrow", "this weekend", "next Friday") and nights plus a start date, all resolved against the injected clock. Every resolved range is shown back as concrete dates, and the guest confirms it before the search runs. Plain party phrases ("me and my wife", "just me", "a couple") set the guest count.

## Acceptance criteria

- AC1: No search runs with dates the guest did not give or confirm.
- AC2: "this weekend" resolves to the Friday–Sunday range after the injected clock, and the reply shows both dates.
- AC3: A range longer than 14 nights or beyond the 90-day horizon is refused with a plain explanation that states the limit.
- AC4: "me and my wife" sets 2 guests, and "just me" sets 1.
- AC5: If only the nights are known, the concierge asks for the start date instead of assuming one.

## ADR compliance

| ADR | Constraint |
|---|---|
| 0023 | Stays are 14 nights or fewer |
| 0055 | Booking horizon is 90 days or less |
| 0031 | Arrivals fall in the bounded arrival window |
| 0054 | Same-day bookings are allowed without shortcuts |

## Definition of Done

- [ ] Every AC has one named test (name mirrors the criterion) and named failure paths are asserted.
- [ ] Relevant ADRs were re-read and mapped above; non-obvious constraints cited at the callsite.
- [ ] No invented policy strings: guest-facing wording for money/legal states traces to CONTEXT.md or an ADR; gaps raised with the user.
- [ ] No bearer credentials or contact values in telemetry or logs (ADR 0075).
- [ ] `npm run check` and `npm test` pass.

## Comments
- 28 Sept 2026: the audit for launch-readiness issue 10 found this work implemented and tested on main, but this file was never set to resolved. The status is left for a human to confirm against the Definition of Done.
