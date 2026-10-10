# Paystack transfer adapter and webhook

Status: ready-for-human
Type: task
Blocked by: 01

## What to build

Build the Paystack implementation of the transfer port.

- Charge API, `bank_transfer` channel, with `account_expires_at` set to the Payment Window deadline. Paystack raises any expiry under 15 minutes to 15, so the deadline must be at least 15 minutes away when the account is created; otherwise, fail closed.
- Confirm through the webhook with its signature verified, and double-check with transaction verification.
- Check the exact amount, currency and reference.
- Money arriving after expiry follows ADR 0045 and ADR 0047: it is recorded, refunded in full, and never confirms a booking.

## Acceptance criteria

- AC1: A transfer charge is created with the booking reference, exact amount in kobo and an expiry equal to the Payment Window deadline, and fails closed if that deadline is less than 15 minutes away.
- AC2: A signed Paystack success event for the designated reference and exact amount confirms the booking once; an unsigned, mismatched-amount, unknown-reference or duplicate event confirms nothing.
- AC3: A success reported after the deadline never confirms the booking and is recorded for a full refund.
- AC4: Before switching transfers on in production, the ADR 0047 certification cases pass against Paystack test mode (before and after expiry, wrong amount, duplicate, delayed event, in flight at the deadline), recorded in this issue.

## ADR compliance

| ADR | Constraint |
|---|---|
| 0088 | Paystack Charge API; expiry = Payment Window deadline |
| 0047 | certification cases before activation |
| 0044 | 20-minute window, one grace of at most 10 minutes |
| 0045 | late money refunded, never confirms |
| 0075 | no keys, account numbers or webhook bodies in logs |

## Definition of Done

- [x] Every AC has one named test (AC1–AC3; AC4 is the manual certification below) (name mirrors the criterion) and named failure paths are asserted.
- [x] Relevant ADRs were re-read and mapped above; non-obvious constraints cited at the callsite.
- [x] No invented policy strings: guest wording for money and deadlines traces to CONTEXT.md or an ADR.
- [x] No keys, secrets, account numbers or webhook bodies in logs or telemetry (ADR 0075).
- [x] `npm run check` and `npm test` pass.

## Answer

AC1–AC3 are built on branch `pay/p2-paystack-transfer-adapter`, stacked on P1. **AC4 needs you**: it is a manual run against Paystack test mode, so the issue stays `ready-for-human` until it is recorded below. Transfers stay switched off in production until then.

- **Adapter:** `PaystackBankTransferClient` in `domains/shortlet/src/paystack.ts`.
  - `createTransferAccount` sends `POST /charge` with `email`, the exact `amount` in kobo, `currency: NGN`, the booking `reference`, `bank_transfer.account_expires_at` set to the Payment Window deadline, and `metadata.shortlet_guest_id`.
  - It accepts only a `pending_bank_transfer` answer for that reference, carrying an `account_number`, a `bank.name` and an `account_expires_at`.
  - It refuses before any request when the deadline is less than `PAYSTACK_TRANSFER_MINIMUM_EXPIRY_MINUTES` (15) away, because Paystack would silently extend the account past the deadline (ADR 0088). P1 also refuses any answer whose expiry is later than the deadline.
- **Verification:**
  - `verifyTransferAsync` re-reads `GET /transaction/verify/<reference>` and maps Paystack statuses to success, pending or failed. A result from the wrong environment is not verified.
  - The sync port method refuses. The domain gains `verifyAndProcessTransferWithProviderResult`, and the app gains `verifyAndProcessFromProvider`.
- **Webhook:** `/webhooks/paystack` (already signature-checked with HMAC-SHA512) now routes a `charge.success` for a transfer reference to `verifyAndProcessFromProvider`. The event body is never trusted: amount, currency, reference and payer come from Paystack's verification (ADR 0047). Duplicates confirm once, through the domain's processed-reference idempotency. Late money is recorded as `late_payment_after_expiry` for a full refund and never confirms (ADR 0045).
- **Activation (ADR 0088):**
  - `SHORTLET_PAYSTACK_TRANSFERS` is parsed by `paystackTransfersEnabled`. Unset or `disabled` means off; `enabled` means on; any other value stops startup.
  - The pilot composes `PaystackBankTransferClient` as `bankTransferProvider` only when the switch is on.
- **Tests:** `test/paystack-transfer-adapter.test.ts` covers AC1–AC3, with the signed webhook exercised through the real guest server. The fake (`test/helpers/paystack-http.ts`) now answers `/charge` in the documented response shape.
- **Checks:** `npm run check` is clean. `npm test` gave 1202 passed, 0 failed and 1 skipped.

### AC4 certification (to run in Paystack test mode, then record here)

Set `PAYSTACK_SECRET_KEY` to the **test** secret, `PAYSTACK_ENVIRONMENT=test`, and point the dashboard webhook at `<origin>/webhooks/paystack`. For each case, record the date, reference, what Paystack did, and what the booking did.

| Case (ADR 0047) | Expected |
|---|---|
| Pay the exact amount before expiry | Booking confirms once |
| Pay after the account expires | Paystack refuses or refunds; the booking does not confirm; any credit is recorded as `late_payment_after_expiry` |
| Pay a wrong amount | Paystack rejects (`bank.transfer.rejected`); nothing confirms |
| Pay twice / duplicate webhook | Confirms once; the second is recorded for refund |
| Delayed webhook (replay later) | Confirms if still before the deadline, otherwise late refund |
| In flight at the deadline | Only a pre-deadline in-flight transfer may finish within grace (ADR 0044) |
| Webhook without a valid signature | 401, nothing changes |

Then set `SHORTLET_PAYSTACK_TRANSFERS=enabled`.

**Known gap (P3):** transfer sessions are still held in memory, so a restart would make the webhook ignore a reference it no longer knows. P3 makes them durable. Until then, keep transfers disabled in production.

**Deferred (27 Sept 2026):** there is no Paystack API access yet. The certification and activation are tracked in `.scratch/shortlet-concierge-launch/issues/47-activate-paystack-pay-with-transfer.md` and must be done before transfers are switched on in production.
