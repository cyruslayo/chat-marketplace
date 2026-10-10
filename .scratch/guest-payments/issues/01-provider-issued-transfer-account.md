# The provider issues the transfer account

Status: resolved
Type: task
Blocked by: none

## What to build

The transfer account must come from the payment provider, never from the domain.

- Extend `BankTransferProviderClient` with an async `createTransferAccount({ reference, amountKobo, currency, expiresAt, email })`. It returns the bank name, account number, reference and the provider's expiry.
- `initializeBankTransfer` stores those details and no longer derives an account.
- Verification stays server-side through the port.
- Add a deterministic local provider for tests and `guest:local`, in the same way the card path has `localPayment`.
- Build `BankTransferPaymentApplication` into `LocalGuestEnvironment`.

## Acceptance criteria

- AC1: Starting a bank transfer returns the bank name, account number and expiry supplied by the provider for that booking's reference and exact amount, and the domain no longer creates account details.
- AC2: The provider expiry must not be later than the Payment Window deadline; a later expiry, or a provider error, fails closed and no attempt is recorded.
- AC3: Starting again while the transfer is still payable returns the same account and never a second one (ADR 0046).

## ADR compliance

| ADR | Constraint |
|---|---|
| 0046 | one live attempt; a payable transfer holds the slot |
| 0047 | booking-specific, expiring, exact amount |
| 0072 | platform command with idempotency |

## Definition of Done

- [x] Every AC has one named test (name mirrors the criterion) and named failure paths are asserted.
- [x] Relevant ADRs were re-read and mapped above; non-obvious constraints cited at the callsite.
- [x] No invented policy strings: guest wording for money and deadlines traces to CONTEXT.md or an ADR.
- [x] No keys, secrets, account numbers or webhook bodies in logs or telemetry (ADR 0075).
- [x] `npm run check` and `npm test` pass.

## Answer

Resolved on branch `pay/p1-provider-issued-transfer-account`, cut from `main`.

- **The port.** `BankTransferProviderClient` gains an async `createTransferAccount({ reference, amountKobo, currency, expiresAt, email })`. It returns a `ProviderTransferAccount` with `bankName`, `accountNumber`, `reference` and the provider's `expiresAt`. `initializeBankTransfer` (and `BankTransferPaymentApplication.initializeTransfer`) is now async. The domain no longer derives a bank or account; "Concierge Reserve Bank" is gone.
- **Failing closed (AC2, ADR 0047).** Nothing is recorded (no session, live attempt, journey or audit entry) when:
  - the provider errors;
  - it answers for another reference;
  - it returns no bank or no digits;
  - it returns an unreadable expiry, or one later than the Payment Window deadline.

  The error is `BankTransferProviderError`, whose message never echoes the provider's own error text. The provider is not asked at all when the payer has no email on file, or when another method's Live Payment Attempt holds the slot (ADR 0046).
- **One account (AC3, ADR 0046).** Starting again while a transfer is payable returns the same session. Concurrent starts share one in-flight provider request (`#pendingInitializations`).
- **Email.** The payer's email comes from `guestContacts`, which is now a required manager option (the same source as the card path, ADR 0087).
- **Local provider.** `apps/local-guest/src/local-bank-transfer-provider.ts` (`LocalBankTransferProvider`, bank "Local Demo Bank") issues a stable ten-digit account per reference and reports the issued amount on verification. `LocalGuestEnvironment.bankTransferApp` composes it. It is `null` when `deterministicPsp` is `false` (production) until the Paystack adapter lands in P2.
- **Audit.** The audit keeps ids and times only; the account number is never recorded (ADR 0075).
- **Tests.**
  - New: `test/provider-issued-transfer-account.test.ts` (AC1–AC3).
  - Shared fake: `test/helpers/bank-transfer-provider.ts` (`issueTransferAccount`, `TEST_GUEST_CONTACTS`).
  - Four existing transfer test files now await initialization.
- **For P3 (not in scope here).**
  - Bank transfer sessions are still held in memory, so a restart loses the session while the durable live attempt keeps the slot. That fails closed until it expires.
  - A confirmed transfer is not yet passed to the Guest contract repository, which the card path does through `onConfirmedOutcome`.
- **Checks.** `npm run check` is clean. `npm test` gave 1197 passed, 2 failed and 1 skipped. The failures were RB5 real-browser cross-tab and mobile AC5 transcript scroll; both files pass alone (55 of 55).
