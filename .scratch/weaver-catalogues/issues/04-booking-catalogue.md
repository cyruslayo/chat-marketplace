# `shortlet-booking/v1`: StayTicket and PriceBreakdown

Status: resolved
Type: task
Blocked by: 02, 03
Requested: 6 Oct 2026

## Why

The booking and payment builders emit the stay ticket and the money lines as label-prefixed Basic Texts:
- `ticketFactComponents` in `apps/web-agent/src/booking-presentation.ts` produces `Check-in: …`, `Check-out: …` and `Stay: N nights · G guests`
- the money lines are `All-In Stay Total: …`, `Refundable Security Deposit (separate): …`, `Total to complete booking: …`, `Stay payment paid: …`, `Next payment: …` and the bare text `If your request is accepted`

`organizeBookingTicket` (`apps/local-guest/src/client.ts`, around line 484) finds these by label (`findFact`, `dayNumeral`) and swaps them for `ticketHtml` and `breakdownHtml` markup. It also reads the booking reference and `depositCollected` from `activePayload.confirmation` on the client side.

## What to build

- **Components** in `SHORTLET_BOOKING_CATALOG`. All values are display strings formatted on the server; the client calculates nothing (ADR 0077).
  - `StayTicket { title, checkIn: { day, date, datetime? }, checkOut: { day, date, datetime? }, foot }`
  - `PriceBreakdown { condition?, total?, totalLabel?, deposit?, depositCollected?, due?, thisPayment?, paid?, next? }`

  These mirror `TicketParts` and `BreakdownParts` in `guest-kit.ts`.
- **Renderers** in `apps/local-guest/src/shortlet-renderers.ts`:
  - a shared `kitNode(document, html)`, which is the `<template>` parsing lifted from `replaceWithKitMarkup`
  - `StayTicket`, which renders `ticketHtml(props)`
  - `PriceBreakdown`, which renders `breakdownHtml(props)`

  Register both for the booking catalogue id.
- **Builders.** In `booking-presentation.ts`, add `ticketComponent(prefix, …)` and `breakdownComponent(prefix, …)` to replace `ticketFactComponents` and the label-prefixed money Texts. Build the parts with the same formatters the pages use (`formatTicketDate`, `formatStayFoot`, `formatNgnKobo`), so the page and the chat share one source.

  The booking reference and `depositCollected` become props.

  Switch these builders to `SHORTLET_BOOKING_CATALOG`:
  - `booking-request`
  - `request-draft`
  - `conditional-offer`
  - `card-payment`
  - `bank-transfer`
  - `booking-contract`

  Also switch any other builder that calls `ticketFactComponents`.
- **Incomplete dates.** When the projection lacks a check-out or check-in date, the builder emits **no** StayTicket. It falls back to plain Basic Texts carrying the facts it has, so meaning is never silently dropped (ADR 0074).
- **Client.** Delete `organizeBookingTicket` and its dispatch in `enhanceSurfacePresentation`. `organizeRequestScreen`, `organizeOfferScreen`, `organizePaymentScreen` and `organizeConfirmation` stay and must keep working off the rendered `.ui-ticket` and `.ui-price-breakdown`. Rebuild `dist/client.js`.

## Acceptance criteria

- **AC1:** For the review, offer, payment and confirmed stages, the chat's `.ui-ticket` and `.ui-price-breakdown` `outerHTML` equal the conventional page's. Keep `test/guest-presentation-parity-chromium.test.ts` AC3 and the request, offer and payment consistency Chromium suites green **without changing their expectations**.
- **AC2:** With the check-out date missing from the projection, the chat renders no `.ui-ticket`, still shows the check-in and stay facts as text and still shows the `.ui-price-breakdown`, and announces no error. Update the AC4 mutation in `guest-presentation-parity-chromium` to remove the date from the projection or props, not a component id.
- **AC3:** The booking reference on the confirmed ticket and the "Refundable Security Deposit collected" wording come from props. The client no longer reads `activePayload.confirmation` for them (source-scan test).
- **AC4:** Every switched builder's output validates against `SHORTLET_BOOKING_CATALOG`, and a `StayTicket` or `PriceBreakdown` with an extra or missing required property is rejected. Extend `test/shortlet-catalog-validation.test.ts`.
- **AC5:** Text in props that contains HTML, such as a unit title `<img src=x onerror=…>`, renders as literal text in the ticket (ADR 0075).
- **AC6:** `client.ts` no longer defines `organizeBookingTicket`.
- **AC7:** Captures of the request, offer, payment and confirmation screens (chat and page) at 320, 390, 768 and 1280 go in `.scratch/guest-ui-consistency/screenshots/weaver-04/`, made with `capture-07.ts`, `capture-08.ts`, `capture-09.ts` and `capture-10.ts`. They show no horizontal overflow and no control under 44px.

## Tests to update

- the catalogue-id and fact assertions in `render-{booking-request,conditional-offer,card-payment,bank-transfer,booking-contract}-weaver-a2ui.test.ts`
- `phase4-booking-payment-presentation.test.ts`
- `guest-presentation-contract*.test.ts` (the label-prefixed contract this issue replaces)

## ADR compliance

| ADR | Constraint | Where |
| --- | --- | --- |
| 0073 / 0075 | Compile-time schema; typed and validated props; no agent HTML. | AC4, AC5 |
| 0074 | Never silently omit meaning; text fallback. | AC2 |
| 0077 / 0015 | No client recalculation; the All-In Stay Total leads and the deposit is shown separately. | Props formatted on the server; `breakdownHtml` order unchanged |
| 0078 | 44px targets, 320px reflow. | AC7 |
| 0080 | The conventional pages are unchanged. | AC1 |

## Comments

### Implementation (19 Nov 2026, branch `claude/wonderful-thompson-iicglk`; commits `2ca7630`, `adeb5ff`, `36f8db8`)

Orchestrated: the orchestrator wrote the catalogue schemas, the shared ticket parts and the client removal, and verified every step; Haiku 5.5 agents (medium effort, one writer at a time) wrote the renderers, converted the six builders, retargeted the existing tests and wrote the new acceptance tests.

- **Catalogue** (`shortlet-catalogs.ts`): `shortlet-booking/v1` adds `StayTicket { title, checkIn: { day, date, datetime? }, checkOut, foot }` and `PriceBreakdown { condition?, total?, totalLabel?, deposit?, depositCollected?, due?, thisPayment?, paid?, next? }`, `additionalProperties: false`.
- **One source for the ticket** (`booking-presentation.ts`): `TicketDatePart`, `TicketParts` and `BreakdownParts` moved here from `guest-kit.ts` (re-exported there), with `ticketDatePart(iso)`, `ticketParts(title, stay)`, `bookingTicketComponents(prefix, title, stay)` and `priceBreakdownComponent(prefix, parts)`. The page's `stayTicketHtml` and the builders build the ticket ends the same way (day and `datetime` from the ISO date).
- **Renderers** (`shortlet-renderers.ts`): `StayTicket` → `ticketHtml`, `PriceBreakdown` → `breakdownHtml`, registered for the booking catalogue.
- **Builders**: booking-request, request-draft, conditional-offer, card-payment, bank-transfer and booking-contract emit the StayTicket in the title's place and, when the surface has an All-In Stay Total, the PriceBreakdown in the first money line's place, on `SHORTLET_BOOKING_CATALOG_ID`. Without both dates the builder emits the title, the dates it has and the stay as Basic Texts (AC2); without a total the money Texts stay as they were, as the organizer left them. booking-contract passes `depositCollected` as a prop.
- **Client**: `organizeBookingTicket`, `findFact`, `dayNumeral`, `replaceWithKitMarkup` and the unused imports deleted; the client no longer reads `confirmation.depositCollected`. `organizeRequestScreen`, `organizeOfferScreen`, `organizePaymentScreen` and `organizeConfirmation` are unchanged and work off the rendered `.ui-ticket` and `.ui-price-breakdown`. `dist/client.js` rebuilt.

### AC3 note (owner to confirm)

The chat's confirmed ticket never showed the booking reference (its foot is "3 nights · 2 guests" at every stage, as on the page; the parity test compares them). The reference is shown by the confirmation screen's own "Booking reference" block from the `confirmation` payload, which `organizeConfirmation` still renders. Putting the reference on the ticket would break page parity, so only the deposit-collected wording moved to props; the source scan covers it.

### Parity evidence

`npx tsx .scratch/weaver-catalogues/dump-booking.ts` (real Chromium, 390px) at draft, review, pending, offer, payment-ready, handoff, deposit-ready, deposit-handoff and confirmed: the chat's `.ui-ticket` and `.ui-price-breakdown` are identical to the organizer's output, apart from the `datetime` attribute the page already carries (the parity test strips it).

### Validation

- `npm run check` clean.
- Retargeted (agent, reviewed): `render-{booking-request,conditional-offer,card-payment,bank-transfer,booking-contract}-weaver-a2ui`, `phase4-booking-payment-presentation`, `guest-presentation-contract` (the label-prefixed contract becomes "a typed StayTicket and PriceBreakdown in canonical order"; the draft still has no amount line and the order is still enforced), `shortlet-catalog-validation` AC2, `demo-monthly-prices-and-periods` AC2, `local-guest-weaver-demo` (the offer's rendered money text is still checked, in the kit's layout, plus the props), one recording re-recorded offline (component types only). No assertion removed. Set of 14 files: 197 passed.
- New: `test/weaver-booking-catalogue.test.ts` (AC2, AC3, AC5, AC6) and "Weaver catalogues 04 AC4" in `shortlet-catalog-validation` (journey surfaces validate; seven malformed shapes rejected): 13 passed.
- Real Chrome, one at a time: `guest-presentation-parity-chromium` 2/2 (AC3 unchanged; AC4 now removes the date at the builder level, expectations unchanged), `guest-request-consistency-chromium` 7/7, `guest-offer-consistency-chromium` 5/5, `guest-payment-consistency-chromium` 3/3, `guest-confirmation-system-chromium` 3/3, `guest-final-acceptance-chromium` 3/3, `guest-real-browser-cross-tab` 14/14, `mobile-guest-journey-chromium` 43/43.
- AC7: `capture-07.ts` to `capture-10.ts` (request, offer, payment, confirmation and system screens, chat and page) passed their reflow and 44px assertions at 320, 390, 768 and 1280; 120 captures in `.scratch/guest-ui-consistency/screenshots/weaver-04/`.
- The full `npm test` and `npm run test:workers` run once for the batch, before merge (CLAUDE.md).

### ADR compliance

| ADR | Constraint | Where it is met |
| --- | --- | --- |
| 0073 / 0075 | Compile-time schema; typed props; no agent HTML. | AC4 rejects seven malformed shapes; AC5 renders a hostile title as text. |
| 0074 | Never silently omit meaning. | AC2: without a date, no ticket, the facts stay as text, the breakdown still shows, no error. |
| 0077 / 0015 | No client recalculation; the total leads, the deposit is separate. | Server-formatted props; `breakdownHtml` order unchanged; identical DOM at nine stages. |
| 0078 | 44px, 320px reflow. | AC7 captures. |
| 0080 | Conventional pages unchanged. | `stayTicketHtml` output identical (guest-kit tests and parity AC3). |
| 0102 | Typed components on the approved booking ID; kit markup only. | As above. |

### Definition of Done

1. AC1: parity AC3 and the request, offer and payment consistency suites, unchanged. AC2–AC6: named tests above. AC7: the captures.
2. Failure paths: a missing check-out date, a surface without a total (old Texts kept), seven malformed shapes, a hostile title.
3. ADRs 0015, 0073, 0074, 0075, 0077, 0078, 0080 and 0102 read.
4. No new injected dependency.
5. No new policy string or amount; labels come from `GUEST_FACT_LABELS` through the kit.
6. No logging added.
7. `npm run check` clean; full suite at the batch gate.
