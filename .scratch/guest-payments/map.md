# Guest payments: card and bank transfer (map)

Guests choose card or bank transfer, both through the platform's Paystack account. A third option, manual transfer to your business account with a receipt, is planned as P5. The back office verifies it, and ADR 0090 governs it.

- Governing decisions: [ADR 0088](../../docs/adr/0088-offer-card-and-bank-transfer-through-paystack.md) (payment methods) and [ADR 0089](../../docs/adr/0089-collect-guest-payments-and-pay-owners-the-agreed-amount.md) (collection and owner payouts).
- Unchanged: ADR 0044 (20 + 10 minute Payment Window), ADR 0045 (late payments refunded), ADR 0046 (one live attempt), ADR 0047 (expiring, booking-specific transfer), ADR 0049 (fresh hosted card checkout).

## What exists (26 Sept 2026)

- **Card:** Paystack hosted checkout, wired end to end (`DirectPaystackClient.initializeTransaction`, `CardPaymentApplication`).
- **Bank transfer:**
  - `BankTransferPaymentManager` (`domains/shortlet/src/bank-transfer.ts`), `BankTransferPaymentApplication` and `bankTransferArtifactToA2UI` exist.
  - None of them is built into the guest environment.
  - The domain **invents the account itself** ("Concierge Reserve Bank (GTBank)" plus a derived number), and its provider port only verifies.
  - The screen shows raw status codes and amounts in the "NGN 1234.00" format, not the guest glossary.
- **Deposit:** the transfer and card flows collect the stay and then a separate deposit. Launch units carry a zero deposit (ADR 0089), so each booking takes one payment. That is listing data, not code.

## Delivery rules

- **One slice per branch and PR.** Each slice is one branch `pay/<id>-<slug>` and one PR, stacked on the one below. The user reviews after P3.
- **Tests first.** One named test per acceptance criterion, including failure paths.
  - Paystack HTTP is mocked with `test/helpers/paystack-http.ts`.
  - Real Paystack test mode is used only in the manual certification step (P2 AC4).
- **Checks.** `npm run check` and `npm test` pass (known flaky tests as in `scratch/map.md`).
- **Walkthrough.** Check `npm run guest:local` at 320px and 375px, paying both ways with the deterministic local provider.
- **Secrets.** Paystack keys and webhook payloads never appear in logs or telemetry (ADR 0075).

## Slices

| Slice | Issue | Blocked by |
|---|---|---|
| P1 | [01](issues/01-provider-issued-transfer-account.md) The provider issues the transfer account | none |
| P2 | [02](issues/02-paystack-transfer-adapter.md) Paystack transfer adapter and webhook | 01 |
| P3 | [03](issues/03-guest-payment-choice.md) Guest chooses card or transfer | 02 |
| P4 | [04](issues/04-margin-pricing.md) Margin pricing and owner payable (ADR 0089) | none (separate lane) |
| P5 | [05](issues/05-manual-transfer-with-receipt.md) Manual bank transfer with receipt upload (ADR 0090) | 03 |

After P3 the guest can pay either way. P4 is the pricing half of ADR 0089. It feeds the Operator back office (see `.scratch/operator-dashboard/`, to be reframed as the owner's back office).

## Context pointers (append as slices resolve)
- P1 provider-issued transfer account: `BankTransferProviderClient.createTransferAccount` (async) returns `ProviderTransferAccount`, and `initializeBankTransfer` / `initializeTransfer` are async. Errors raise `BankTransferProviderError`. `guestContacts` is required. The local provider is `LocalBankTransferProvider` in `apps/local-guest`; `LocalGuestEnvironment.bankTransferApp` is null in production. Test fakes live in `test/helpers/bank-transfer-provider.ts`. Open for P3: durable transfer sessions and `onConfirmedOutcome`.
- P2 Paystack transfer (AC1–AC3 done; AC4 certification pending, you run it): `PaystackBankTransferClient` in `domains/shortlet/src/paystack.ts` (`/charge`, `verifyTransferAsync`) and `PAYSTACK_TRANSFER_MINIMUM_EXPIRY_MINUTES`. `BankTransferPaymentApplication.verifyAndProcessFromProvider` is called from the signed webhook. The pilot switch `SHORTLET_PAYSTACK_TRANSFERS` (`paystackTransfersEnabled`) is off by default. `LocalGuestEnvironment` config takes `bankTransferProvider`.
- P3 payment choice: the choice is on `/payments/offers/<id>` (`transferChoiceHtml`). Transfer screen: `/payments/offers/<id>/transfer` (`renderTransferPageHtml`). A card switch returns 409 `TRANSFER_IN_PROGRESS`. Durable `SqliteBankTransferSessionStore`; a confirmed transfer writes the booking snapshot (`store`) and the Guest contract (`onConfirmedOutcome`).
- P5 manual transfer: `ManualTransferManager` / `SqliteManualTransferStore` in `domains/shortlet/src/manual-transfer.ts` (receipts are a SQLite BLOB). `LocalGuestEnvironment.manualTransfers` (config `manualTransferAccount`, `receiptMaxBytes`). Routes: `/payments/offers/<id>/manual-transfer[/receipt]`. Calendar gains `holdPaymentPendingUntil`. Pilot env: `SHORTLET_MANUAL_TRANSFER_*` and `SHORTLET_RECEIPT_MAX_BYTES`. B6 adds confirm, reject and late credit.
- P4 margin pricing (ADR 0089): `domains/shortlet/src/owner-terms.ts` (`unitPriceFromOwnerTerms`, `unitOwnerTerms`, `ownerSettlementFor`). The quote's `ownerSettlement` rides in the offer and the Booking Contract. Inventory columns are `owner_nightly_ngn`, `owner_mandatory_charges_ngn` and `margin_percent`. Test helper: `test/helpers/owner-terms.ts` (`repricedByOwner`). B7 reads the settlement.
- **Before production:** Paystack Pay with Transfer stays off until issue 47 (`.scratch/shortlet-concierge-launch/issues/47-activate-paystack-pay-with-transfer.md`) is done. It needs Paystack API access, which we don't have yet.
