# Payment screens: choice, card, bank transfer, manual transfer, waiting, no reservation

Status: ready-for-agent
Type: task
Blocked by: 08
Requested: 29 Sept 2026

## Why

Payment has the most screens and the most drift:
- the chat's card-payment and bank-transfer surfaces (`card-payment-a2ui.ts`, `bank-transfer-a2ui.ts`), with the blue "Time left to pay" `.waiting-panel`
- the payment page in the `/payments/offers/:id` handler, with its three stacked method buttons from `transferChoiceHtml`
- `renderTransferPageHtml`, `renderManualTransferPageHtml` and their states: "Payment received", "Your transfer is processing", "Waiting for payment check", "This transfer account has expired", "No Reservation was made"

The design (`design/PaymentChoice`, `CardHandoff`, `BankTransfer`, `ManualTransfer`, `PaymentWaiting`, `NoReservation`) gives them one layout: the deadline banner, then the ticket, then the breakdown, then one details card.

## What to build

- **Payment choice.**
  - head, the deadline banner, the ticket, and the breakdown with the "Next payment · stay payment ₦…" row
  - "How would you like to pay?": a `.ui-segmented` **radio group** (Card / Bank transfer) plus one submit, so it works without JavaScript
  - the manual bank transfer option stays offered below as its own action (ADR 0090)
  - a single `POST` handler that dispatches to the **existing** method handlers or commands (card continue, provider transfer, manual transfer), with no new domain behaviour. An unknown or missing method fails closed with the existing error page
  - the note "you can't switch to card until the transfer account expires" stays (existing copy)
- **Card handoff:** the existing "Payment handoff" surface and `/continue`: the banner, the ticket, the "This payment · stay payment ₦…" row, the handoff explanation (existing copy), "Pay ₦… by card", and "Choose another way to pay".
- **Bank transfer** (provider account): the banner ("Transfer by …"), the ticket, one `bankDetailsHtml` card (exact amount, bank, account number with the copy button from d2dfced, the booking-only note), a status pill "Waiting for your transfer", and "Back to your conversation".
- **Manual transfer:** as bank transfer, plus the account name and booking reference, the "receipt alone doesn't confirm it" sentence, and an upload card (`.ui-upload` label wrapping the real file input; the form and limits are unchanged).
- **Waiting states** ("Waiting for payment check", "Your transfer is processing", "Payment received"): a status pill, a neutral banner with the **real** verification deadline from the manual-transfer projection (the design's `[verification deadline]` placeholder), the ticket, and a transfer summary card (amount, reference, receipt time from the projection). If a value isn't projected, ask before adding it.
- **No reservation / expired account:** a danger pill, a danger banner with the absolute expiry time, the late-payment refund sentence (existing copy), then "Back to your conversation" and "Find other stays".
- **Chat surfaces:** replace `.waiting-panel` for payments with the banner plus `.ui-steps` (the outcomes from `guestWaitingGuidance`). The chat bank-transfer surface gets the same copy button, through the client (reversible presentation, ADR 0072).
- **Amounts and labels:** keep today's values exactly. Issue 12 may change what "Amount due now" means. If it is resolved before this ships, apply its answer; otherwise note it in `## Comments`.

## Acceptance criteria

- AC1: Each payment screen renders the same banner, ticket, details and actions in the chat workspace and on its conventional page. One parity test per screen.
- AC2: The payment choice works without JavaScript: choosing Card or Bank transfer and submitting reaches the same route and command as today, and manual bank transfer remains available. Failure path: a missing or unknown method is refused, and no payment attempt starts.
- AC3: Every payment deadline is a `.ui-banner--warning` with an absolute WAT time and the minutes left. No `.waiting-panel` or info-coloured box remains in payment surfaces.
- AC4: The copy button copies the account number in both the chat and the pages and announces "Account number copied". Without JavaScript it stays hidden and the number is selectable text (keep the d2dfced Chromium test).
- AC5: The waiting screens show the verification deadline and receipt time from the projection, never a hardcoded value. The no-reservation screen shows the actual expiry time.
- AC6: Amounts shown equal the projection values used today on each screen (regression test), unless issue 12 was resolved first.

## Tests to update

`guest-payment-choice.test.ts`, `manual-transfer-with-receipt.test.ts`, `manual-transfer-copy-chromium.test.ts`, `provider-issued-transfer-account.test.ts`, `render-bank-transfer-weaver-a2ui.test.ts`, `expire-transfer-and-refund-late-payment.test.ts`, `guest-waiting-states-chromium.test.ts`, `paystack-real-browser.test.ts`.

## ADR compliance

0089, 0090, 0072, 0075 (no account data in URLs or logs), 0078, 0080.

## Comments
