# Stop inventing dates; parse and confirm relative dates

Status: resolved
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
- 11 Oct 2026, **Status reconciliation**: `Status: ready-for-agent` -> `Status: resolved` (reconciled against origin/main 37b9c62).
  - Answer: `scratch/issues/01-confirm-real-dates.md` (repo root). Explicit and relative dates resolve against the injected clock (Africa/Lagos). Relative dates wait for a plain yes before any search runs; over 14 nights or beyond the 90-day horizon is refused with the limit stated; "me and my wife" is 2 guests and "just me" is 1; nights without a start date prompts for one.
  - Evidence: test/guest-real-dates.test.ts (one test per AC). Code: apps/local-guest/src/concierge.ts (`extractStayRequestFacts`); domains/shortlet/src/browse.ts (`MAX_STAY_NIGHTS`, `BOOKING_HORIZON_DAYS`). Landing: PR #53, commit ab1202d.
  - Verified: non-browser tests for this group were run on 11 Oct 2026 (75 of 75 pass).
  - Not verified: real-Chrome tests (`*-chromium.test.ts`, `mobile-guest-journey-chromium.test.ts`) were not run in the reconciliation sandbox (no Chrome); they pass in the CI `browser` job on main. The 320/390/768/1280 screenshots and the ADR 0078 capture sweep were not re-checked. The Definition of Done checklist was not re-ticked item by item in this reconciliation.
