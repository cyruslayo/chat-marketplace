# Conventional /stays/search page

Status: resolved
Type: task
Blocked by: 07
Parent: [06](06-conventional-routes.md)

## What to build

Serve a server-rendered `/stays/search` using `pageShell` and `errorPage` from `apps/web/src/ui-kit.ts`, following `renderConventionalUnitDetailHtml` (`guest-server.ts:1658`). Match the route before the unit regex (:2045). Search criteria come from the query string built by `apps/web/src/presentation.ts:24–30`.

## Acceptance criteria

AC numbers are kept from the parent issue for traceability.

- AC2: `/stays/search` never reaches the unit-detail handler.
- AC1 (search part): `/stays/search` built by the guest app returns 200 with the matching results.

## ADR compliance

| ADR | Constraint |
|---|---|
| 0080 as modified by 0081 | Material workflows have conventional route parity |

## Definition of Done

- [ ] Every AC has one named test (name mirrors the criterion) and named failure paths are asserted.
- [ ] Relevant ADRs were re-read and mapped above; non-obvious constraints cited at the callsite.
- [ ] No invented policy strings: guest-facing wording for money/legal states traces to CONTEXT.md or an ADR; gaps raised with the user.
- [ ] No bearer credentials or contact values in telemetry or logs (ADR 0075).
- [ ] `npm run check` and `npm test` pass.

## Comments
- 28 Sept 2026: the audit for launch-readiness issue 10 found this work implemented and tested on main, but this file was never set to resolved. The status is left for a human to confirm against the Definition of Done.
- 11 Oct 2026, **Status reconciliation**: `Status: ready-for-agent` -> `Status: resolved` (reconciled against origin/main 37b9c62).
  - Answer: `scratch/issues/06a-conventional-search.md` (repo root). `GET /stays/search` is served before the unit route, which had returned 404 "Apartment not found". `parseConventionalSearchQuery` fails closed with 400 `SEARCH_INVALID`. Results link to `/stays/:id` with All-In Stay Total and Refundable Security Deposit.
  - Evidence: test/guest-conventional-search.test.ts (AC1, AC2 and restored-discovery emitted routes, with 400 failure paths). Code: apps/local-guest/src/guest-server.ts (exact `GET /stays/search` route before the unit route); `parseConventionalSearchQuery`. Landing: PR #56, commit 86ebe50.
  - Verified: non-browser tests for this group were run on 11 Oct 2026 (75 of 75 pass).
  - Not verified: real-Chrome tests (`*-chromium.test.ts`, `mobile-guest-journey-chromium.test.ts`) were not run in the reconciliation sandbox (no Chrome); they pass in the CI `browser` job on main. The 320/390/768/1280 screenshots and the ADR 0078 capture sweep were not re-checked. The Definition of Done checklist was not re-ticked item by item in this reconciliation.
