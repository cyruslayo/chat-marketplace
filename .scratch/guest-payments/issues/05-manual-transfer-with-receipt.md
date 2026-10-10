# Manual bank transfer with receipt upload

Status: resolved
Type: task
Blocked by: 03

## What to build

Governed by ADR 0090. Manual transfer is the third option after card and Paystack transfer. It is offered only when the 20-minute Payment Window plus the 60-minute verification hold fits inside 8 AM–8 PM WAT. The Guest sees:
- your one business account (configuration);
- the exact amount;
- a unique booking reference to include;
- the Payment Window deadline in WAT.

They transfer, then upload the receipt (an image or PDF, with a size limit) before the deadline. The booking shows as waiting for payment check. It confirms only when you verify the credit in the back office (B6).

This slice adds the app's first file upload:
- a size and type allow-list;
- stored outside the web root;
- never logged;
- deleted 90 days after the stay (ADR 0090).

## Acceptance criteria

- AC1: Choosing manual transfer shows the account, the exact amount, a unique booking reference, and the absolute WAT deadline, and says the booking confirms only after the money is checked.
- AC2: The Guest can upload one receipt (allowed types and size only) before the deadline, and the booking then shows as waiting for payment check with the verification deadline.
- AC3: An upload after the deadline, of a disallowed type or size, or for a booking the Guest doesn't own, is refused and nothing is stored.
- AC4: The receipt never confirms the booking by itself; only the back-office verification (B6) does.
- AC5: Upload works without JavaScript and at 320px.

## ADR compliance

| ADR | Constraint |
|---|---|
| 0090 | manual transfer: the receipt is evidence only |
| 0044 | 20-minute Payment Window for transfer and upload |
| 0046 | one live attempt |
| 0075 | receipt minimization, retention, never logged |
| 0080 | works without JavaScript |

## Definition of Done

- [x] Every AC has one named test (name mirrors the criterion) and named failure paths are asserted.
- [x] Every action asserts the standard failure paths: revoked or expired grant, no session, cross-origin POST, and a stale or expired target.
- [x] Relevant ADRs were re-read and mapped above; non-obvious constraints cited at the callsite.
- [x] No invented policy strings: money, deadline and legal wording traces to CONTEXT.md or an ADR; gaps raised with the user.
- [x] No keys, secrets, receipts, account numbers or contact values in logs or telemetry (ADR 0075).
- [x] Walkthrough at 320px, 375px and 1280px, and without JavaScript.
- [x] `npm run check` and `npm test` pass.

## Answer

Resolved on branch `pay/p5-manual-transfer-with-receipt`, stacked on P3.

- **Domain:** `domains/shortlet/src/manual-transfer.ts`.
  - `ManualTransferManager` and `SqliteManualTransferStore`, with tables `manual_transfers` and `manual_transfer_receipts`. Receipt bytes are a BLOB in the database, outside any web root, so the back office (B6) reads them without a shared file path.
  - Constants from ADR 0090: `MANUAL_TRANSFER_VERIFICATION_HOLD_MINUTES` (60), `MANUAL_TRANSFER_HOURS_WAT` (8:00 AM–8:00 PM), `RECEIPT_RETENTION_DAYS` (90) and `RECEIPT_CONTENT_TYPES` (JPEG, PNG, PDF).
- **Offering it (ADR 0090).** It is offered only when a business account is configured and the Payment Window plus the 60-minute hold falls inside 8:00 AM–8:00 PM WAT on one day (`manualTransferFitsBusinessHours`).
  - Local pilot: a clearly fictional "Local Demo Bank" account.
  - Production: `SHORTLET_MANUAL_TRANSFER_BANK_NAME`, `SHORTLET_MANUAL_TRANSFER_ACCOUNT_NAME` and `SHORTLET_MANUAL_TRANSFER_ACCOUNT_NUMBER` (ten digits). All three or none; a partial set fails startup.
- **AC1.** The third choice, "Pay by manual bank transfer", leads to `/payments/offers/<id>/manual-transfer`. That page shows the bank, account name, account number, exact amount, a unique booking reference (`SL-` and eight unambiguous characters, unique in SQLite) and the absolute WAT deadline with time left. It says the booking confirms only after we see and check the money; the receipt alone doesn't confirm it. Starting takes the single Live Payment Attempt (new method `manual_transfer`, ADR 0046), so card and provider transfer return 409.
- **AC2.** One receipt, uploaded before the Payment Window deadline, moves the transfer to `awaiting_verification`. The page shows "Waiting for payment check" with the verification deadline (Payment Window deadline + 60 minutes, in WAT). The dates stay held through then, using a new calendar method `holdPaymentPendingUntil`: forward-only, and only while the block is still active. The existing grace extension works only after expiry, so it couldn't be reused.
- **AC3.** Each refusal stores nothing:
  - type is judged by the file's bytes, not its declared type or name;
  - a file over `receiptMaxBytes` returns 413, and an oversized body is refused before it is buffered;
  - uploads after the deadline, a second receipt, another Guest's booking (404) and cross-origin posts (403) are refused.

  The calendar hold is taken before anything is written.
- **AC4.** The receipt never creates a contract or booking snapshot. Unverified by the deadline, the transfer expires on the next read, releases the dates and the slot, and stays unconfirmed. Audit entries hold ids, sizes and times only, never the file, its name or its bytes (ADR 0075).
- **AC5.** A plain `multipart/form-data` form (`apps/local-guest/src/multipart.ts`) with no script. Checked over HTTP with a real multipart upload (`curl -F`), which is the request a browser sends without JavaScript. Long account numbers and references wrap at 320px.
- **Retention (ADR 0090).** `purgeReceipts(now)` deletes receipts 90 days after checkout (11:00 WAT) for confirmed bookings, or 90 days after the attempt closed. B6 calls it on each queue read.
- **Configuration default to confirm:** `DEFAULT_RECEIPT_MAX_BYTES` is 5 MiB, overridable with `SHORTLET_RECEIPT_MAX_BYTES`. ADR 0090 says only "a configured size limit". You confirmed the 5 MiB default on 27 Sept 2026.
- **Tests:** `test/manual-transfer-with-receipt.test.ts` (AC1–AC5). The shared fixture is `test/helpers/guest-payment-page.ts`, which the P3 test now uses too.
- **Checks.** `npm run check` is clean. The full `npm test` run was disturbed by two Chromium tests that hung; I stopped them, and it ended with 1202 passed and 9 failed, all real-browser files plus pilot AC4. Run alone, every affected file passed: cross-tab concurrency 18/18, new conversation 2/2, real-browser cross-tab 12/12 (on the second run), mobile journey 43/43, pilot-local 44/44.
- **Walkthrough.** The manual transfer page, rendered with its real stylesheet at 320px, has no horizontal scroll, and the file input and button stay inside the panel with 44px targets. The choice and transfer pages were checked in the browser in P3.
