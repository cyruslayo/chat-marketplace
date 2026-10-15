# Platform Payments: move the Paystack port, webhook, transfer verification and receipt store out of shortlet

Status: resolved
Type: task
Blocked by: 09a
Requested: 14 Oct 2026
Unlocks: 22
Lane: C: Platform services
PRD: `../PRD.md`

## Why

Payments live in `domains/shortlet` (PRD, Diagnosis 7); commerce must not import shortlet.

## What to build

1. Create a deep `Payments` module in `packages/platform-core` with a small interface (`start(intent)`, `confirm(reference)`, `handleWebhook(request)`, `verifyTransfer(...)`) that hides `domains/shortlet/src/paystack.ts`, the transfer-verification parts of `bank-transfer.ts`/`manual-transfer.ts`, and `receipt-blob-store.ts`.
2. Booking ledger, reservations, payment windows and owner payables stay in shortlet and react to payment outcomes.
3. Hosts (`apps/pilot`, `apps/cloudflare`) construct Payments once and pass it to packs.

## Out of scope

- Commerce split payments (22).

## Acceptance criteria

- AC1: `domains/shortlet` has no Paystack HTTP or webhook-signature code; it calls Payments.
- AC2: Payment intents carry a domain id and reference so outcomes route to the right pack.
- AC3: All existing card, bank-transfer and manual-transfer tests pass unchanged.
- AC4: No secret key or card data appears in audit or logs (ADR 0075).

## Tests

Platform payments tests reusing `test/helpers/paystack-http.ts` and `bank-transfer-provider.ts`; existing flow tests.

## ADR compliance

| ADR | Why it matters here |
| --- | --- |
| `docs/adr/0087-select-paystack-for-pilot-shortlet-payments.md` | Provider-neutral port. |
| `docs/adr/0088-offer-card-and-bank-transfer-through-paystack.md` | Methods. |
| `docs/adr/0090-accept-manual-bank-transfer-verified-against-the-credit.md` | Manual transfer. |
| `docs/adr/0096-export-payment-references-in-plaintext.md` | Reference export unchanged. |
| `docs/adr/0075-secure-and-minimize-agent-interaction-data.md` | No credentials in logs. |

Before starting, also list `docs/adr/` and read any other ADR that touches the files you change (AGENTS.md implementation protocol).

## Definition of Done

Apply every item of the Definition of Done in `docs/agents/issue-tracker.md`. Shortlet behaviour must not change: the existing tests and the guest UI walkthrough/capture checks are the safety net.

## Comments

- **ADR compliance (DoD 3).** ADR 0087: the adapter keeps the HMAC-SHA512 `x-paystack-signature` check over the raw body and `charge.success` is treated as a prompt, not proof — `PaystackPayments.handleWebhook` returns `invalid-signature` / `invalid` / `ignored` / `charge`, and the host still re-verifies server-side. ADR 0088/0047: the transfer port and the 15-minute minimum expiry moved unchanged; the synchronous port method still refuses a network verification. ADR 0090/0096: receipt storage moved to the platform; the plaintext-reference export is untouched. ADR 0075: the module keeps only non-sensitive facts — the intent registry stores `{domainId, method}`, verification keeps the brand/last4 projection, and no secret enters an outcome or an error. ADR 0099 rules 2/4: the payer metadata key was made configurable (`PaystackConfiguration.payerMetadataKey`, default `shortlet_guest_id`) so the provider adapter no longer hardcodes a domain name.
- **Decision — the transfer manager keeps the provider port.** `BankTransferPaymentManager` composes the provider-neutral `BankTransferProviderClient` (now declared in `packages/platform-core/src/payments/provider.ts`) because the existing tests construct it directly and the synchronous verify path is a port method (`test/provider-issued-transfer-account.test.ts`, `test/booking-finalization-integrity.test.ts`). A host passes `payments.transfers` (the Paystack client) as that port; the card application and the webhook route call the four-method `Payments` interface (`start`/`confirm`/`verifyTransfer`/`handleWebhook`).
- **Compatibility.** `PSPVerifyResult`/`MockPSPVerifyResult` and the `BankTransfer*` provider contracts are re-exported from `domains/shortlet/src/index.ts` so existing importers keep working; the Paystack-named values (`DirectPaystackClient`, `PaystackBankTransferClient`, `loadPaystackConfiguration`, `isApprovedPaystackCheckoutUrl`, …) are imported from the platform module by hosts and tests.

## Answer

`packages/platform-core/src/payments/` is the deep Payments module: `provider.ts` (provider-neutral contracts + the intent registry), `paystack.ts` (the moved adapter, `node:crypto` webhook signature), `receipt-blob-store.ts` (moved), and `payments.ts` (`Payments` + `PaystackPayments`). `domains/shortlet/src/paystack.ts` and `receipt-blob-store.ts` are deleted; card-payment and bank-transfer now import their provider types from the platform and `manual-transfer` composes the platform receipt store. The shortlet manager still owns the ledger, reservations, payment windows and owner payables and reacts to outcomes.

Tests: `test/platform-payments.test.ts` (AC1 shortlet has no Paystack HTTP/webhook code; AC2 intents carry domain id + reference and outcomes route back, unknown references fail closed; AC3 the moved adapter keeps the card/transfer/receipt contracts; AC4 no secret or raw card data enters state or an outcome). The existing card, bank-transfer, manual-transfer and receipt suites pass unchanged.

AC2 note: the transfer *manager* passes no domain id on the account request (doing so broke `test/provider-issued-transfer-account.test.ts`'s exact-shape assertion); a transfer intent records its domain when it is started through `Payments.start`, and the host keeps routing transfers by app lookup as before.

Test evidence: `npm run check` clean; `npm test -- --browser-only` 0 failures; `npm test -- --non-browser` 1769/1773 with the four failures that pre-date this slice on the working baseline (`16 AC1 (fixture)` export fixture, and the three `redact-platform-ids-generators` cases), none in the payment, card, bank-transfer, manual-transfer or receipt suites.
