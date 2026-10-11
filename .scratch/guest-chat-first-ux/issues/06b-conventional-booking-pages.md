# Conventional booking pages with owner checks

Status: resolved
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
- 11 Oct 2026, **Status reconciliation**: `Status: ready-for-agent` -> `Status: resolved` (reconciled against origin/main 37b9c62).
  - Answer: `scratch/issues/06b-conventional-booking-pages.md` (repo root). `/booking-requests/:id`, `/booking-requests/drafts/:id`, `/conditional-offers/:id` and `/booking-contracts/:id` are served. A page is returned only when the principal owns the record through a stored thread projection and the domain checks pass. Anonymous gets 401; not owned or unknown gets 404 `BOOKING_RECORD_NOT_FOUND`.
  - Evidence: test/guest-conventional-booking-pages.test.ts (AC1 with anonymous 401; AC4 owner checks). Code: apps/local-guest/src/guest-server.ts; `LocalGuestApp.conventionalBookingPage`. Landing: PR #57, commit d6c06f6.
  - Verified: non-browser tests for this group were run on 11 Oct 2026 (75 of 75 pass).
  - Not verified: real-Chrome tests (`*-chromium.test.ts`, `mobile-guest-journey-chromium.test.ts`) were not run in the reconciliation sandbox (no Chrome); they pass in the CI `browser` job on main. The 320/390/768/1280 screenshots and the ADR 0078 capture sweep were not re-checked. The Definition of Done checklist was not re-ticked item by item in this reconciliation.
