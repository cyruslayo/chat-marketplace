# Activate Paystack Pay with Transfer before production

Status: ready-for-human
Type: HITL
Blocking: switching on bank transfer (Paystack) in production

## Why this is open

The Paystack transfer adapter is built and tested against a fake Paystack API only. The owner does not yet have Paystack API access (noted 27 Sept 2026). Until it is certified against Paystack test mode, **Pay with Transfer must stay switched off in production.** ADR 0088 activates bank transfer only after certification, and ADR 0047 lists the cases.

The owner will set up Paystack and pick this up then.

## What exists (built, off by default)

- The adapter: `PaystackBankTransferClient` in `domains/shortlet/src/paystack.ts`. It sends a Charge API `bank_transfer` charge with `account_expires_at` set to the Payment Window deadline, fails closed under Paystack's 15-minute minimum, and verifies server-side with `verifyTransferAsync`.
- The webhook: `/webhooks/paystack` checks the signature, re-verifies with Paystack, processes once, and records late money for a full refund.
- The switch: `SHORTLET_PAYSTACK_TRANSFERS`. Unset or `disabled` means off; `enabled` means on; any other value stops startup. It is parsed by `paystackTransfersEnabled` in `apps/pilot/src/pilot-config.ts`.
- Tests: `test/paystack-transfer-adapter.test.ts`, which uses a fake HTTP API in the response shape from Paystack's docs.
- Delivered in PR cyruslayo/chat-marketplace#76 (slice P2). Details: `.scratch/guest-payments/issues/02-paystack-transfer-adapter.md`.

Card payment and manual bank transfer (ADR 0090) do not depend on this issue. Card payment already uses Paystack hosted checkout and needs its own live keys for the pilot.

## What to do

1. Get Paystack access with Pay with Transfer enabled on the account, and the **test** secret key.
2. Run the guest server with `PAYSTACK_SECRET_KEY` set to the test key and `PAYSTACK_ENVIRONMENT=test`. Point the dashboard webhook at `<public origin>/webhooks/paystack`.
3. Before relying on the fixture, compare a real `/charge` response and a `charge.success` webhook body with the fake in `test/helpers/paystack-http.ts`. Adjust the adapter if Paystack's live shape differs.
4. Run the certification cases below, and record for each: the date, the reference, what Paystack did, and what the booking did.
5. Only then set `SHORTLET_PAYSTACK_TRANSFERS=enabled` in production, with the live key.

## Acceptance criteria (ADR 0047 certification)

- [ ] Paying the exact amount before expiry confirms the booking once.
- [ ] Paying after the account expires: Paystack refuses or refunds; the booking does not confirm; any credit is recorded as `late_payment_after_expiry`.
- [ ] A wrong amount: Paystack rejects it (`bank.transfer.rejected`); nothing confirms.
- [ ] Paying twice, or a duplicate webhook: the booking confirms once; the duplicate is recorded for refund.
- [ ] A delayed webhook (replayed later) confirms only if still before the deadline; otherwise it is recorded as a late refund.
- [ ] Only a pre-deadline in-flight transfer may finish within the Payment-Processing Grace (ADR 0044).
- [ ] A webhook without a valid signature returns 401 and changes nothing.
- [ ] Results are recorded here; then `SHORTLET_PAYSTACK_TRANSFERS=enabled` is set in production.

## ADR compliance

| ADR | Constraint |
|---|---|
| 0088 | Pay with Transfer is switched on only after test-mode certification |
| 0047 | the certification cases; provider-enforced expiry at the Payment Window deadline |
| 0044 | 20-minute Payment Window; one grace of at most 10 minutes |
| 0045 | late money is refunded in full and never confirms |
| 0075 | no keys, account numbers or webhook bodies in logs |
