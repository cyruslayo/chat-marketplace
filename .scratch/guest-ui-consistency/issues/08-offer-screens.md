# Offer screens: live and expired

Status: ready-for-agent
Type: task
Blocked by: 07
Requested: 29 Sept 2026

## Why

The Conditional Booking Offer shows a blue "Time left to accept and pay" box in the chat (`.waiting-panel`, from `guestWaitingGuidance("offer-payment-window")`) and a different layout on `/conditional-offers/:id`. In the design (`design/Offer`, `OfferExpired`), the deadline is the one warning banner.

## What to build

- **Live offer** (chat workspace and conventional page):
  - head: eyebrow "Conditional Booking Offer", title, success status pill ("The provider confirmed your dates", from existing copy)
  - `deadlineBannerHtml`: "Pay by <absolute WAT> · N minutes left", plus the existing consequence sentence
  - the ticket, and the breakdown with the amount-due line
  - a "Before you pay" card linking the offer's policies (cancellation, house rules) as the offer artifact exposes them. Only show links the artifact has
  - action bar: amount plus "Accept and pay" (the existing accept action and route)
- **Expired offer:** a danger status pill "Conditional Booking Offer expired", a neutral banner with the deadline that passed and "no payment was taken" (existing copy), the ticket, then "Back to your conversation" and "Find other stays"; the rail's failed step.
- The waiting guidance's outcomes and "meanwhile" lines move into the banner and a `.ui-steps` card. No `.waiting-panel` remains for offers.

## Acceptance criteria

- AC1: The live offer renders the same banner, ticket, breakdown, policies card and action in the chat workspace and on `/conditional-offers/:id`. Parity test.
- AC2: The deadline shows as an absolute WAT time plus the minutes left, taken from the offer's payment window, and updates as time passes (fixture clock). At or after the deadline, the expired screen renders instead (a lazy expiry check).
- AC3: The expired offer shows the failed rail step, no accept action, and both navigation actions. Failure path: posting accept after expiry is refused as today.
- AC4: Offers render no `.waiting-panel` and no info-coloured box. The banner uses `.ui-banner--warning` (update `guest-waiting-states-chromium.test.ts`).
- AC5: Without JavaScript, the offer page's accept form works and the expired page renders.

## ADR compliance

0078 (absolute deadlines), 0080, 0072, 0015, 0089.

## Comments
