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
| 0075 | No bearer credentials or contact values in logs |

## Definition of Done

- [x] Every AC has one named test (name mirrors the criterion) and named failure paths are asserted.
- [x] Relevant ADRs were re-read and mapped above; non-obvious constraints cited at the callsite.
- [x] No invented policy strings: guest-facing wording for money/legal states traces to CONTEXT.md or an ADR; gaps raised with the user.
- [x] No bearer credentials or contact values in telemetry or logs (ADR 0075).
- [x] `npm run check` and `npm test` pass.

## Answer

- Root cause (AC1): the guest app emitted `/booking-requests/:id`, `/booking-requests/drafts/:id`, `/conditional-offers/:id` and `/booking-contracts/:id`, but the guest server had no handler for any of them.
- `LocalGuestApp.conventionalBookingPage(kind, id, principal)` builds each page. It returns `null` (fail closed) unless all of these hold:
  - the principal is this runtime's Guest, with a present id and tenant;
  - one of that Guest's own stored thread projections correlates the record (`draftId`, `requestId`, `offerId`, or the booking snapshot's `contractId`);
  - the domain record names the Guest: the draft's Primary Guest; the request's Primary Guest and tenant; the offer's Primary Guest or distinct payer and tenant; the contract through `getAuthorizedContractForApplication` (ADR-0070).
- Reads go through `getConventionalBookingRequestView`, `getConventionalConditionalOfferView` and `getConventionalBookingContractView` (ADR-0072). Page text reuses the concierge's own fallbacks (`#draftFallback`, `#requestSurface`, `#offerFallback`, `#confirmedBookingFallback`), so no new policy wording was added. The draft page follows the thread's current view (Request Draft or Request review).
- The server matches these routes outside the `/stays/*` session exemption:
  - no browser session: 401 `AUTHENTICATION_REQUIRED`;
  - bad encoding: 400 `INVALID_BOOKING_LINK`;
  - anything not owned or unknown: 404 `BOOKING_RECORD_NOT_FOUND`, which does not reveal whether the record exists.
  The page links back to `/?threadId=…`.
- AC4: someone else's record fails closed at the application level (another guest id, empty id, missing tenant, other tenant, operator role, unknown id, for all four kinds) and over HTTP (a second session-scoped guest gets 404 for the first guest's draft).
- Tests: `test/guest-conventional-booking-pages.test.ts`. AC1 GETs every booking route while its surface is current, then again at the end of the journey, and covers the anonymous 401. `restartFixture` exposes `app`.
- Plan deviation: `findGuestThreadForOffer` was left unchanged. The page lookup parses the owned thread projections directly, so the planned generalisation wasn't needed.
- Verification: `npm run check` passed. `npm test`: 1,110 passed, 1 failed, 1 skipped. The failure was S1 "AC5: New turns scroll into view… at 320px" (`mobile-guest-journey-chromium.test.ts`), a scroll timing check under load; it passed when rerun alone, and this slice does not touch the client. Walkthrough on :3001 at 375px and 1280px: the draft link from the concierge opened the Request Draft page, and an unknown offer id gave the 404 page.
