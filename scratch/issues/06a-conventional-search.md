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

- [x] Every AC has one named test (name mirrors the criterion) and named failure paths are asserted.
- [x] Relevant ADRs were re-read and mapped above; non-obvious constraints cited at the callsite.
- [x] No invented policy strings: guest-facing wording for money/legal states traces to CONTEXT.md or an ADR; gaps raised with the user.
- [x] No bearer credentials or contact values in telemetry or logs (ADR 0075).
- [x] `npm run check` and `npm test` pass.

## Answer

- Root cause (AC2): `/stays/search` matched the unit regex `/^\/stays\/([^/]+)$/`, so "search" was looked up as a unit id and returned 404 "Apartment not found". An exact `GET /stays/search` route now sits before the unit route in `guest-server.ts` (ADR-0080 cited at the callsite). It keeps the public `/stays/` session exemption, because search is a public read.
- AC1: `parseConventionalSearchQuery` accepts only the criteria `conventionalSearchRoute` builds for the guest app: `location`, `neighbourhood`, `checkIn`, `checkOut`, `partySize`, `bedrooms`. An unknown key, a repeated key, an empty value, a non-integer count, or a domain rejection from `UnitDiscoveryQuery.search` (one date only, bad dates, horizon) fails closed with a 400 `SEARCH_INVALID` page. `renderConventionalSearchHtml` lists each result with its `/stays/:id` route, All-In Stay Total, Refundable Security Deposit and capacity, using `GUEST_GLOSSARY` wording.
- The count line is now `discoveryFallbackMessage` in `apps/web-agent/src/presentation.ts`, one source shared by the concierge fallback, the "see all" surface, restored discovery and the search page.
- Emitted-route fixes found while testing AC1:
  - Restored discovery now emits `conventionalSearchRoute(artifact.facts.filters)` instead of a criteria-free `/stays/search`.
  - The restored unit-detail surface emitted `conventionalBookingRequestRoute("")`, which is `/booking-requests/`. It now emits the discovery artifact's `/stays/:id` route.
- Tests: `test/guest-conventional-search.test.ts` has AC2, AC1 (the live route, with its 400 failure paths) and AC1 for restored discovery and unit surfaces. `restartFixture` in `test/helpers/guest-restart.ts` now exposes `base` and accepts server options.
- Verification: `npm run check` passed. `npm test`: 1,109 passed, 0 failed, 1 skipped. Walkthrough on :3001 at 375px and 1280px used the Old Ikoyi search from 29 Sept.
