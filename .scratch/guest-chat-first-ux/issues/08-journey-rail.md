# Journey rail and back to results

Status: resolved
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

## Comments
- 11 Oct 2026, **Status reconciliation**: `Status: ready-for-agent` -> `Status: resolved` (reconciled against origin/main 37b9c62).
  - Answer: `scratch/issues/08-journey-rail.md` (repo root). `projectJourney` builds the six steps and marks an outcome step failed. `#journeyFor` reads the authoritative artifacts on every call, so a passed deadline shows as expired without a background job. `BACK_TO_RESULTS_EVENT` fails closed (`STALE_SURFACE`, `INVALID_ARTIFACT`, `INVALID_CONTEXT`) and runs no new search.
  - Evidence: test/guest-journey-rail.test.ts (AC1–AC4 over HTTP, plus `projectJourney`); test/guest-journey-rail-chromium.test.ts (375px, 320px overflow). Code: apps/local-guest/src/journey-rail.ts (`projectJourney`); apps/local-guest/src/guest-server.ts (`#journeyFor`, `#handleBackToResults`). Landing: PR #59, commits 6e347ed, 5c4785f.
  - Verified: non-browser tests for this group were run on 11 Oct 2026 (75 of 75 pass).
  - Not verified: real-Chrome tests (`*-chromium.test.ts`, `mobile-guest-journey-chromium.test.ts`) were not run in the reconciliation sandbox (no Chrome); they pass in the CI `browser` job on main. The 320/390/768/1280 screenshots and the ADR 0078 capture sweep were not re-checked. The Definition of Done checklist was not re-ticked item by item in this reconciliation.
