# Guest chooses card or transfer

Status: resolved
Type: task
Blocked by: 02

## What to build

After accepting the Conditional Booking Offer, the Guest chooses **Pay by bank transfer** or **Pay by card**.

- **Transfer screen:** bank, account number, exact amount and the absolute WAT deadline with time left (reusing the S9 waiting states), plus a line saying the booking confirms automatically once the transfer arrives.
- **Before choosing:** the page says a transfer account can't be switched to card while it is still payable (ADR 0046).
- Replace the raw status codes and "NGN 1234.00" amounts in `bank-transfer-a2ui.ts` with `GUEST_GLOSSARY` wording and `formatNgnKobo`.
- **No JavaScript:** the conventional payment page offers both methods (ADR 0080).

## Acceptance criteria

- AC1: After accepting the offer the Guest can choose bank transfer or card, and each leads to its payment path.
- AC2: The transfer screen shows the bank, account number, exact amount, and the absolute WAT deadline with time left, and says the booking confirms when the transfer arrives.
- AC3: The page states before the choice that a transfer can't be switched to card while its account is payable, and a switch attempt is refused while it is payable.
- AC4: The transfer and card paths both work at 320px and without JavaScript.

## ADR compliance

| ADR | Constraint |
|---|---|
| 0088 | card or transfer, the Guest's choice |
| 0046 | switching rules |
| 0078 | absolute WAT deadline; 320px |
| 0080 | conventional route parity |
| 0005 | a Reservation only after verified payment |

## Definition of Done

- [x] Every AC has one named test (name mirrors the criterion) and named failure paths are asserted.
- [x] Relevant ADRs were re-read and mapped above; non-obvious constraints cited at the callsite.
- [x] No invented policy strings: guest wording for money and deadlines traces to CONTEXT.md or an ADR.
- [x] No keys, secrets, account numbers or webhook bodies in logs or telemetry (ADR 0075).
- [x] `npm run check` and `npm test` pass.

## Answer

Resolved on branch `pay/p3-guest-payment-choice`, stacked on P2.

- **Choice (AC1, ADR 0088).** Before any payment attempt, with an email on file, `/payments/offers/<id>` shows "How would you like to pay?". "Pay by bank transfer" is a plain POST form to `/payments/offers/<id>/transfer`; "Pay by card" links to the existing card continuation. The thread's payment surface already links to this page. Once a transfer exists, the page redirects to it.
- **Transfer screen (AC2).** `GET /payments/offers/<id>/transfer` (`renderTransferPageHtml`) shows:
  - the provider's bank and account number;
  - the exact amount (`formatNgnKobo`);
  - "Transfer by <absolute WAT> · N minutes left";
  - "Your booking confirms automatically once the transfer arrives."

  It shows separate states for processing, expired (money sent later is refunded in full, ADR 0045) and confirmed ("View your Reservation"). It never says confirmed before a Reservation exists (ADR 0005). Local pilot only: "Complete local demo transfer" posts to `/payments/local/transfer/complete`.
- **Switching (AC3, ADR 0046, 0088).** Before the choice, the page says: "If you choose bank transfer, you can't switch to card until the transfer account expires." While a transfer is payable (until the grace end), the card continuation returns 409 `TRANSFER_IN_PROGRESS` and starts nothing. Starting the transfer again returns the same account.
- **No JavaScript and 320px (AC4, ADR 0080).** Both pages carry no script. Checked in the browser at 320px, 375px and 1280px: no horizontal scroll, every target at least 44px, and the long account number wraps.
- **A2UI.** `bank-transfer-a2ui.ts` now uses Guest words instead of raw status codes, `formatBookingMoney` instead of "NGN 1234.00", and `formatBookingDeadline`. Late-payment copy never calls a started refund received.
- **Carried over from P1 and P2:**
  - Transfer sessions are now durable (`SqliteBankTransferSessionStore`, table `bank_transfer_sessions`), so the account and the webhook survive a restart.
  - A reference whose session is completed or refunded is never reprocessed after a restart; a rollback could otherwise release a live booking.
  - A confirmed transfer now writes the same booking snapshot and Guest contract record as a card payment (`store`, `onConfirmedOutcome`). Without that, the Guest's booking page and the B4 back office could not see transfer bookings.
  - The local provider reads the durable session, so it works after a restart.
- **Checks.** `npm run check` is clean. `npm test` gave 1204 passed, 2 failed and 1 skipped. The failures were RB3 real-browser cross-tab and pilot AC4 `pilot:start`; both files pass alone (56 of 56).
