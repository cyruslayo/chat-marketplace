# `shortlet-booking/v1`: StayTicket and PriceBreakdown

Status: ready-for-agent
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
