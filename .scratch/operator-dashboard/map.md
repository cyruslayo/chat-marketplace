# Back office: map

Your internal back office: `apps/local-owner` (`/operator/*`), which the pilot server serves at `/operator/*`. It replaces the earlier "Operator dashboard" map (26 Sept 2026).

- PRD: [PRD.md](PRD.md) · Payments plan: [../guest-payments/map.md](../guest-payments/map.md)
- Decisions: [ADR 0088](../../docs/adr/0088-offer-card-and-bank-transfer-through-paystack.md), [ADR 0089](../../docs/adr/0089-collect-guest-payments-and-pay-owners-the-agreed-amount.md), [ADR 0090](../../docs/adr/0090-accept-manual-bank-transfer-verified-against-the-credit.md) (manual transfer; in PR #68)

## Delivery rules

- **One slice per branch and PR.** Each slice is one branch `bo/<id>-<slug>` and one PR, stacked on the one below. Review per milestone.
- **Tests first.** One named test per acceptance criterion. Every action also tests:
  - a revoked or expired grant is denied (ADR 0082);
  - there is no session (ADR 0086);
  - a cross-origin POST is rejected;
  - a stale or expired target is refused.
- **Checks.** `npm run check` and `npm test` pass. The real-browser tests run in their own serial phase (issue 12).
- **Walkthrough.** Check at 320px, 375px and 1280px, including without JavaScript (ADR 0080).
- **Hotspot.** Only one slice at a time edits the renderers in `local-owner-server.ts` or `LocalApartmentOwnerEnvironment`.
- **No invented policy.** Money, deadline and legal wording traces to `domains/shortlet/CONTEXT.md` or an ADR.

## Slices (frontier = first open, unblocked row)

| Slice | Issue | Blocked by | Milestone |
|---|---|---|---|
| B0 | Baseline, and a shared sign-in helper `test/helpers/operator-session.ts` (no issue file) | none | M1 |
| B1 | [01](issues/01-back-office-home.md) Back-office shell and "waiting on you" home | B0 | M1 |
| B2 | [02](issues/02-request-inbox.md) Request inbox: deadlines and owners | 01 | M1 |
| B3 | [03](issues/03-confirm-and-decline.md) Confirm on the owner's behalf; decline with a reason | 02 | M1 |
| B4 | [04](issues/04-bookings.md) Bookings and their payment state | 03 | M2 |
| B5 | [05](issues/05-reservation-and-check-in.md) Reservation detail and recording check-in | 04 | M2 |
| B6 | [06](issues/06-verify-manual-transfers.md) Verify manual transfers (ADR 0090) | 04, guest-payments P5 | M2 |
| B7 | [07](issues/07-owner-payables.md) What you owe each owner | 05, guest-payments P4 | M3 |
| B8 | [08](issues/08-calendar-and-blocks.md) Calendar and date blocks | 01 | M4 |

**Milestones:**
- **M1 requests:** you see what is waiting and answer within the 30-minute window.
- **M2 bookings and payments:** each booking, its payment, manual-transfer verification, and check-in.
- **M3 owner payouts:** per booking and per owner, what is owed, when it is due, and what has been paid.
- **M4 calendar:** you block the dates owners tell you are taken.

B8 may run in parallel off B1. The hotspot rule still applies.

**Follow-ups:** [09](issues/09-response-window-starts-at-delivery.md) (resolved 28 Sept 2026): the 30-minute response window starts at delivery (ADR 0043). A Delivery Pending block lasts at most 5 minutes and is extended on acceptance. An undelivered request never times out on the owner.

**Follow-ups from the B7 review (28 Sept 2026):**
- [10](issues/10-resolve-a-blocking-complaint.md) (resolved 28 Sept 2026): dismiss a complaint that did not hold up; the payable is then due at the later of 24 hours after Verified Access and the dismissal.
- [14](issues/14-record-an-upheld-complaint-outcome.md) (resolved 28 Sept 2026): uphold a complaint from the first affected night. The Guest is refunded the unused nights (ADR 0061), which you pay and then record. Refund only: no relocation in the pilot.
- [11](issues/11-flag-owner-over-payment.md) (resolved 28 Sept 2026): an Owner Overpayment is flagged on the card, in the totals and on Home, and recovered off-platform then recorded; other payouts only warn.
- [13](issues/13-imported-blocks-outside-the-calendar.md) (resolved 28 Sept 2026): the `blocked_dates` import column is retired, and blocks are entered only in the back-office calendar. A re-import keeps back-office blocks.
- [12](issues/12-stabilize-real-browser-tests.md) (resolved): `npm test` runs the real-browser files serially in a second phase, and five consecutive runs passed.

**Dropped from the earlier draft:** Operator Holds, the enforcement appeal, the Revenue Release view (replaced by B7), and deposit claims.

## Decisions

- D1 decline reason: "Dates not available" or "Other reason", no free text. The Guest never sees it. "Dates not available" records a calendar-accuracy event (ADR 0039).
- D2 reminders at 10 and 25 minutes: in-page only (partially meets ADR 0041); channel reminders are a follow-up.
- D3 deposit claims: dropped (zero deposits at launch, ADR 0089).
- D4 superseded: there is no Revenue Release view; B7 shows owner payables (ADR 0089).
- D5–D8 manual transfer, decided 26 Sept 2026 (recommended options) and recorded in ADR 0090:
  - **D5:** it is a third option after card and Paystack transfer.
  - **D6:** a 60-minute verification hold after the 20-minute Payment Window, offered only when it fits inside 8 AM–8 PM WAT.
  - **D7:** receipts are deleted 90 days after the stay.
  - **D8:** one business account, with a unique booking reference.

## Context pointers (append as slices resolve)

- B0 sign-in helper: `test/helpers/operator-session.ts` exports `startOperatorServer` (server over an environment with a supplied `clock`), `signInOperator`, `postOperatorLogin`, `operatorCookieFrom`, `operatorGet` / `operatorPost` (cookie override, extra headers; `""` = no session), `crossOriginPost` (`FOREIGN_ORIGIN`), `signOutOperator`, `revokeOperatorSession` and `revokeRepresentativeGrant`; `test/operator-session-helper.test.ts` pins today's failure paths (no session, logout, revoked or expired session 401; cross-origin 403; revoked grant 409). Baseline: known-flaky `pilot-local` AC4 only.
- B1 back-office shell: `apps/local-owner/src/back-office-view.ts` has `backOfficePage({title, viewer, current, body})`, `BACK_OFFICE_NAV` (add a link per shipped slice), `watTime`/`formatWat` and `SIGN_IN_REASONS`. Home builds `WaitingItem`s (kind `request`; add B6/B7 kinds in `waitingItems`). `env.representativeDisplayName`, `env.requestLabels(requestId)` give names instead of ids. Page GETs without a session 303 to `/operator/login[?reason=expired|signed-out]` (`sessionAuthority.sessionRejection`); POSTs stay 401. Test helper adds `startSignedInOperator({start})`, and `operatorGet` no longer follows redirects. Banner: `apps/pilot/src/startup-banner.ts`.
- B2 request inbox: window and reminder constants plus `operatorResponseReminderDue(request, now)` in `domains/shortlet/src/booking-request.ts` (ADR 0041). The inbox lists `delivery_failed` as "Delivery Failed" (never expired). Rows are `li.bo-request[data-request-id][data-reminder]` with time left from `env.clock()`. One `#bo-reminders` live region is spoken once per `requestId:minute` key. Granted operators now receive `primaryGuestName`. `createDemoIncomingBookingRequest({ delivered: false })` gives Delivery Pending. Open point: ADR 0043 fresh window on late delivery (the domain uses disclosure + 30).
- B3 confirm and decline: `decisionFormsHtml` (ADR 0041 re-attestation, required `attest`, D1 reason radios, hidden `basedOnVersion`). `env.confirmOperatorRequest(id, p, { attested, basedOnVersion })` and `env.declineOperatorRequest(id, p, { reason, basedOnVersion })` fail closed with `OperatorDecisionInputError` (400). Stale, repeat and expired decisions get 409 with the current state and no second offer. `DECLINE_REASONS`/`DeclineReasonCode` live in the environment. "Dates not available" writes audit `calendar_accuracy_event` (impactClass `unavailable_request_decline`). Test helper: `decideRequest`, `renderedDecisionVersion`, `operatorPost(..., form)`. **M1 complete: ready for review (B0–B3).**
- B4 bookings: `apps/local-owner/src/booking-projection.ts` (`projectBookingStage`, stage, method and ended-reason labels). `env.listOperatorBookings` / `env.operatorBooking` (throws "Booking not found") read the offer, journey, attempt and Reservation fresh from SQLite per view. Routes are `/operator/bookings[/<requestId>]`, GET only. Grace: `PAYMENT_PROCESSING_GRACE_MINUTES` / `paymentProcessingGraceEndsAt` in `booking-payment-journey.ts`. Test helper `test/helpers/guest-card-payment.ts` (`guestCardPayments(env)`) drives a Guest card payment on the shared database. B5 extends the detail page into the Reservation page; B6 adds the manual-transfer method and stage.
- B5 Reservation and check-in (ADR 0091): `env.operatorReservation`, `recordVerifiedAccess` and `reportBlockingComplaint` live in `local-owner-environment.ts`. `COMPLAINT_CATEGORY_LABELS`, `CheckInInputError` and `CheckInStaleError` are there too. Routes: POST `/operator/bookings/<id>/verified-access` and `/operator/bookings/<id>/blocking-complaint`. Domain additions:
  - `contractualCheckInWindow` / `ContractualCheckInWindow` (on the unit, the offer and the Booking Contract);
  - `SqliteCheckInSupportStore`;
  - `SUPPORT_VERIFICATION_BASES`;
  - `reportBlockingComplaintAsSupport`;
  - `ownerPayableDueAt` and `CHECK_IN_PROTECTION_WINDOW_HOURS`.

  Tests move the clock days ahead and sign in again (`travelTo`), because sessions last 12 hours. B7 reads `ownerPayableDueAt` for owner payables.
- B6 manual transfers: the queue is `/operator/transfers`; POST `/<id>/confirm|reject|late-credit`; GET `/<id>/receipt`.
  - Environment: `env.listOperatorManualTransfers`, `operatorManualTransfer`, `confirmManualTransfer`, `rejectManualTransfer`, `recordManualLateCredit`, `manualTransferReceipt` and `parseNairaToKobo`.
  - Domain: `ManualTransferManager.confirm`, `reject`, `recordLateCredit` and `purgeReceipts`, plus `normalizeBankReference`.
  - B4's projection knows manual transfers (`checkBy`, and the `transfer_declined` and `transfer_not_verified` ended reasons).
  - The Guest contract repository falls back to the shared booking tables.
  - Home adds the "Manual transfer to verify" waiting item. B7 reads confirmed manual Reservations like any other.
- **M2 complete: ready for review (B4, B5, B6).** B6 depends on guest-payments P1–P5. P2's AC4 (Paystack test-mode certification) still needs you, and Paystack transfers stay off in production until then (`SHORTLET_PAYSTACK_TRANSFERS`).
- B8 calendar and blocks (ADR 0039):
  - The page is `/operator/calendar[?from=]`. POST `/operator/calendar/<unitId>/blocks` and `/<unitId>/blocks/<blockId>/remove`.
  - Environment: `env.listOperatorCalendars`, `operatorCalendar`, `blockOperatorDates` and `removeOperatorBlock`, with `BLOCK_REASONS` (CONTEXT.md) and `CalendarInputError` / `CalendarRefusalError`.
  - Domain: `AvailabilityCalendar.releaseOperatorBlock`, `listActiveCommitments` and `findCommitment`, plus `projectCalendarDays`, `operatorBlockConflict` and `addCalendarDays`.
  - Tests share `test/helpers/back-office-page.ts` (`visibleText`, `addSecondOwner`).
- **M4 complete: ready for review (B8).**
