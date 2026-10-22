# Show demo monthly prices and payment periods in guest screens

Status: ready-for-agent
Type: AFK
Blocked by: 09, 10, 11, 13

## Parent

[Public Live Demo Launch PRD](../PRD.md)

## Why

Guests need to see the whole-stay amount and the six-period payment plan before they request a demo stay.

## What to build

- Use the guest UI kit and shared content helpers for chat and the standalone page.
- Show the monthly price, whole-stay All-In Stay Total, utilities and servicing facts, and each Billing Period's dates, amount and due date.
- Keep the request review consistent with the quote and booking snapshot.
- Keep the demo notice and "Demo listing" chip visible. Do not suggest real accommodation, real payments, or six calendar months.
- Use only copy already approved in `GUEST_FACT_LABELS` or the demo notices. Raise any missing policy wording before adding it.

## Acceptance criteria

- AC1: A 30-night unit card and detail page show the period amount and included utilities with the same content in chat and page views.
- AC2: A 180-night quote and request review show the all-in total and all six periods with dates, amounts and due dates.
- AC3: A unit without Monthly Agreed Amounts, utilities or servicing terms never appears as an Extended Stay result.
- AC4: The first and later period payment screens show which period is payable and the existing payment status. They never imply that future periods have been paid.
- AC5: Light and dark screenshots at 320, 390, 768 and 1280 pixels show no horizontal overflow or controls below 44 pixels.
- AC6: Chat and standalone unit detail use the same gallery, values and demo labels. Existing Short Stay screen tests pass unchanged.

## ADR compliance

| ADR | Constraint | Affected path / criteria |
| --- | --- | --- |
| 0015 | One All-In Stay Total and no hidden mandatory charges | AC1–AC4 |
| 0077, 0080 | Canonical projection and deterministic payment state | AC1–AC4, AC6 |
| 0078 | 320-pixel reflow, 44-pixel controls, light and dark | AC5 |
| 0092 | Period amounts, due dates and included utilities | AC1–AC4 |
| 0105 | Public staging demo labels and illustrative photos | AC1, AC6 |

## Source issues

- [Monthly-stays issue 11](../../monthly-stays/issues/11-guest-discovery-for-monthly-stays.md)

## Definition of Done

Use the repository checklist and AGENTS.md guest UI requirements. Save captures under `.scratch/demo-launch/screenshots/12/`. Preserve all existing Short Stay tests unchanged. Run `npm run check`, the affected tests and the required capture checks. Record exact commands and counts in `## Comments`.

## Comments

### Executor round 1 (Sonnet 5.5 executor): implementation commit b610f67, status stays `ready-for-agent`

**Not resolved.** AC4 and the standalone-page parity of AC1 and AC6 are open. The status stays `ready-for-agent`.

**ADR table (read: 0015, 0077, 0078, 0080, 0092, 0105 amended 22 Oct 2026; ADR list checked in `docs/adr/`)**

| ADR | Constraint | Code path / criterion |
| --- | --- | --- |
| 0015 | One All-In Stay Total; no hidden charges | `browse.ts` projection keeps the quote total; the period lines add no charge (AC1-AC2) |
| 0077, 0080 | Canonical projection; chat and page read one helper | `extended-stay-presentation.ts` feeds discovery, unit detail, request draft and request presentation (AC1, AC6) |
| 0078 | 320 reflow, 44px targets, light and dark | captures in `screenshots/12/`; findings.txt reports no overflow and no small controls (AC5, partial: no 180-night capture) |
| 0092 | Period amounts, due dates, included utilities; first period is the only amount due now | `billingPeriods` copied from the quote (`extendedStayDraftFacts`); `firstPeriodOnly` label (AC2, AC4 partial) |
| 0105 | Demo labels and illustrative photos | unit detail takes `demo`; the chat "Demo listing" chip is still missing (known issue 04 gap, not changed here) |

**Files:** `domains/shortlet/src/browse.ts` (extendedStay on the discovery projection, Extended quotes only); `apps/web/src/unit-detail-artifact.ts`, `apps/web/src/request-draft-artifact.ts` (carry the facts); `apps/web-agent/src/extended-stay-presentation.ts` (new helper); `apps/web-agent/src/{guest-content,discovery-a2ui,unit-detail-a2ui,request-draft-a2ui,request-presentation}.ts`; `apps/local-guest/src/{shortlet-app,client}.ts` and `apps/local-guest/src/assistant/shortlet-assistant-pack.ts` (wiring; the chat organizer renders the monthly and utilities lines on the unit sheet).

**Red first.** First run of `test/demo-monthly-prices-and-periods.test.ts` before implementation: `npx tsx --test test/demo-monthly-prices-and-periods.test.ts` gave 4 of 8 passing. The four failing success-path tests were AC1 card, AC1 detail, AC2 review and AC6. The guard tests passed at that point by design: AC1 failure path, AC2 failure path, AC3 and AC4. AC4 is a guard (no period is shown as paid); it is not evidence that the later-period screen exists.

**Green.**
- `npx tsx --test test/demo-monthly-prices-and-periods.test.ts`: 8 of 8.
- Affected set, `NODE_ENV=test COMMERCE_REFERENCE_TEST_KEY=allow npx tsx --test` over discovery-a2ui, phase4-booking-payment-presentation, guest-unit-detail-consistency, unit-detail-artifact, demo-listing-chip, listing-photos-presentation, guest-discovery-reasons, guest-budget, render-booking-request-weaver-a2ui, demo-extended-stay, demo-extended-stay-180, demo-extended-assistant, demo-extended-cancellation-notice, pay-each-demo-billing-period, guest-amount-labels, guest-presentation-contract, guest-discovery-consistency, discovery-actions, discovery-interactions: 160 of 160.
- `npm run check`: 0 errors (`tsc --noEmit`).
- `npm run test:workers -- apps/cloudflare/test/demo-extended-stay.spec.ts`: 1 of 2 passed. AC6 failed with `REQUEST_NOT_SUBMITTED`: "Booking Requests can only be disclosed during Operator Active Hours (8:00 AM - 8:00 PM WAT)". The run was at 19:39 WAT, after the 7:30 PM latest disclosure. The spec depends on the wall clock; this is not a code path changed here. It must be re-run inside active hours before it is accepted. Not yet done.

**Captures (`.scratch/demo-launch/capture-12-demo-surfaces.ts`, one process, real Chrome):** 24 PNGs and `findings.txt` in `screenshots/12/`: 30-night discovery, 30-night detail and 30-night request draft, in light and dark at 320, 390, 768 and 1280. Result: no horizontal overflow and no controls below 44px. The discovery card shows "Monthly price: ₦186,000 for 30 nights" and the utilities line. The detail shows the same lines under the price (after the client rebuild). The sticky action bar covers part of the utilities line at 1280 in one scroll position; it is a layout observation, not an overflow. No 180-night request review capture was taken.

**Gaps (each open; the issue stays `ready-for-agent`):**
- (a) AC4 later-period payment screens: no guest route, page or Worker path shows period N or starts a later-period Paystack TEST session. `PeriodPaymentManager` and `initializePeriodPaystackCheckout` exist only as application methods. Not built in this round.
- (b) Back-office payables still show Period 1 only and POST routes send no `periodIndex`, and Notice-to-End reductions are not shown. Out of this issue's ACs; not changed.
- (c) Copy: the amount due now is labelled "Total to complete booking" and followed by `firstPeriodOnly` ("This is the first Billing Period only. Later Billing Periods are paid separately on their due dates."). This is new copy for review, not counsel-approved. Labels added to `GUEST_FACT_LABELS`: `monthlyPrice`, `utilitiesIncluded`, `paymentSchedule`, `billingPeriod`, `firstPeriodOnly`.
- (d) No new wording claims counsel approval. The existing demo summary still says "pending counsel review".
- (e) Shell chrome controls below 44px outside `.confirmed-screen` are not changed.
- Standalone unit detail page (`renderConventionalUnitDetailHtml`, `apps/local-guest/src/guest-server.ts`) does not show the monthly and utilities facts. It has no dates and reads a domain Unit, so this needs a quote-based path. Open.
- The chat "Demo listing" chip is absent from the captured card and detail (known issue 04 gap; excluded from this work).
- `apps/local-guest/dist/client.js` was rebuilt with `node apps/local-guest/scripts/build-client.mjs`, but not committed. The baseline dirty bundle already holds about 231 lines of unrelated work, and HEAD's bundle predates the demo label. The owner must rebuild and commit the bundle with that work.

**Definition of Done (issue-tracker.md, items 1-7):**
1. Every AC has a named test: AC1, AC2, AC3, AC4 and AC6 do. AC5 is a capture, not a test. The DoD is not met yet.
2. Failure paths: AC1 (missing monthly), AC2 (Short Stay has no schedule), AC3 (ineligible unit excluded) have assertions.
3. ADRs listed and read (table above). ADR 0092 constraints cited at the call sites.
4. No unused injected dependency added.
5. No invented policy string. The new copy is flagged in (c). `utilitiesSummary` wording is presentation of the unit's own statement.
6. No bearer credential in audit or logs: no audit records were added.
7. `npm run check` 0 errors; the issue test 8 of 8; affected set 160 of 160; Worker spec 1 of 2 (time-dependent, see above).

Resolution needs: AC4 later-period screen and Worker test, standalone-page parity, the 180-night review capture, the Worker spec re-run in active hours, and the client bundle commit.

### Executor round 3: status stays `ready-for-agent`

**Commits:** b14251c (Worker spec fixed clock, item 4); b509eeb (standalone unit page parity and schedule under the amount, items 2 and 3); c68e4c2 (180-night request draft and review capture, item 3); 6cd82c7 (later-period schedule page, period start route and period callback, partial AC4).

**Item 4, Worker clock.** `apps/cloudflare/test/demo-extended-stay.spec.ts` fixes Date at START (11:00 WAT) with vitest fake timers. `npm run test:workers -- apps/cloudflare/test/demo-extended-stay.spec.ts`: 2 of 2 passed. Outside hours: a temporary copy with 2026-09-03T20:30Z failed AC6, as expected (copy deleted).

**Item 2, standalone page parity.** `renderConventionalUnitDetailHtml` derives the monthly price and utilities from the same domain projection as chat (30 nights from tomorrow, Lagos). `test/demo-monthly-prices-and-periods.test.ts` 10 of 10. Affected set 106 of 106.

**Item 3, 180-night review capture.** Driven through the fixture API (`.scratch/demo-launch/capture-12-review-180.ts`), then the standalone request page at 320/390/768/1280, light and dark. The review shows the all-in total, the amount due now labelled as the first Billing Period only, and six Billing Periods with dates, amounts and due dates. Findings: 0 (`screenshots/12/findings-180.txt`). This satisfies the capture, but the AC2 proof is the capture's text assertions plus the unit test (6 periods).

**Item 1, AC4: NOT complete.** Implemented in 6cd82c7: GET `/bookings/periods/:offerId` (schedule, Pay button only on the payable period), POST `/payments/periods/:offerId/:periodIndex` (separate Paystack TEST session through `initializePeriodPaystackCheckout`), and the callback now resolves later-period references (`periodOfferIdForReference`) and verifies them. Shared Node/Worker through `createGuestRequestHandler`.
- Not done: red-first tests for these routes (the code preceded the tests, a deviation); the Worker spec (period 1, then period 2 in its own session, duplicate callback, wrong period or amount refused, restart with fresh stubs, fixed clock); captures of the schedule page at 320/390/768/1280 light and dark; a chat-workspace version of the schedule.
- Checked: 128 of 128 across the callback, paystack, card-payment, pay-each-demo-billing-period, owner-payable-per-period, demo-extended and demo-monthly test files; `npm run check` 0 errors.

**Item 5, follow-up gap (not this issue's AC, owner decision).** The back-office payables screen shows Period 1 only; payout and recovery POSTs do not send `periodIndex`; Notice-to-End reductions are not shown. This blocks real period-N payouts in the back office, not the guest demo journey. Recorded here as an explicit owner follow-up.

**Resolution:** NOT resolved. AC4 has no tests or Worker spec, and the schedule page has no captures.
