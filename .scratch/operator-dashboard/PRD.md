# PRD: Back office

Status: draft for review (26 Sept 2026). This replaces the earlier "Operator dashboard" draft.
Map: [map.md](map.md) · Payments plan: [../guest-payments/map.md](../guest-payments/map.md)

## Why this changed

The business is curated B2B2C (ADR 0089).

- The platform owner (**you**) sources apartments from owners, operators and managers, lists and runs every unit, sells stays to guests, collects every payment, and pays each owner the agreed amount.
- Owners never sign in. The "Operator" screens are therefore your back office, not an owner portal.

## One person, many owners

The existing sign-in already fits.

- You sign in with a one-time token and a 12-hour session (ADR 0086).
- You hold one representative grant per owner (ADR 0082).
- The inbox already combines every owner you hold a grant for (`listOperatorRequestArtifacts`).
- Every screen names the owner and the apartment, because you work across all of them.

## The system you run

```
Guest request ──► you check with the owner (≤30 min, 8 AM–8 PM WAT) ──► confirm or decline
      │
      ▼
Guest pays: card · Paystack transfer · manual transfer + receipt (you verify the money arrived)
      │
      ▼
Reservation ──► check-in (you record Verified Access) ──► 24 h, no blocking complaint ──► owner payable due
                                                                                          │
                                                                                          ▼
                                                                          you pay the owner and record it
```

Two bottlenecks sit on you:
- the 30-minute confirmation loop (ADR 0041, ADR 0042);
- verifying manual transfers.

The back office exists to make both fast and to show the money owed.

## Goals

1. **At 320px, the home page shows everything waiting on you:** requests to answer, transfers to verify, and payouts due, each with its WAT deadline or due date.
2. **Answering a request is quick and truthful.** Confirm re-attests the ADR 0041 facts on the owner's behalf; decline records the reason agreed in D1.
3. **Every booking is visible from request to stay,** including its payment method and state.
4. **Manual transfers are verified against the money.** A receipt is evidence only; you confirm after the credit appears in your bank account (ADR 0090).
5. **What you owe each owner is always clear.** For each booking this is the amount received, the owner payable, your margin, the due date, and whether it has been paid. Paid-out amounts are recorded with date and reference (ADR 0089).
6. **You keep the calendar accurate.** You block the dates owners tell you are taken (ADR 0039).

## Non-goals (for now)

- **Owner sign-up or owner self-service.** For the same reason, enforcement appeals (ADR 0064) and trust tiers are out.
- **Automatic owner payouts, reserves and payout plans.** ADR 0089 replaces them.
- **Security Deposit Claims.** Deposits are zero at launch.
- **Operator Holds (ADR 0040).** You block dates directly instead.
- **Editing listings on screen.** Listings stay in the curated inventory file for now.
- **Staff roles beyond you, and multi-person workflows.** The grant model allows staff later.

## What exists (verified 26 Sept 2026)

- **Built:** sign-in, a combined request inbox, and confirm or decline (`apps/local-owner/src/local-owner-server.ts`, served at `/operator/*` by the pilot). The home page shows actor and tenant ids.
- **Built, no screen:**
  - calendar commands (`availability.ts`; there is no remove-block method);
  - Verified Access by staff verification (`CheckInSupportApplication.recordSupportVerification`);
  - payment artifacts for card and bank transfer.
- **Missing:**
  - manual transfer with receipt upload (no file upload exists anywhere);
  - owner agreed amounts and margin (guest-payments P4);
  - an owner-payable ledger;
  - a shared sign-in helper for the operator tests.

## Cross-cutting constraints

| ADR | Constraint |
|---|---|
| 0005, 0006 | Request, then offer, then Reservation only after verified payment; the owner is the accommodation provider |
| 0041, 0042 | 30-minute response window during 8 AM–8 PM WAT; confirmation re-attests the listed facts |
| 0044, 0046 | Payment Window, one live attempt, and one grace period |
| 0089 | Owner payable captured at confirmation; due 24 hours after Verified Access with no Blocking Fulfilment Complaint; paid by you |
| 0090 | A manual transfer confirms only when you verify the credit; the receipt alone never confirms |
| 0072, 0082, 0086 | Every action is a platform command that re-checks your grant for that owner; revoked fails closed |
| 0075 | Receipts and bank details are minimized, never logged, and retained only as ADR 0090 allows |
| 0077, 0078, 0080 | Canonical facts, never recalculated; 320px and absolute WAT times; works without JavaScript |

## Decisions

Decided (carried over, 26 Sept 2026):
- **D1:** decline reason is "Dates not available" or "Other reason", with no free text.
- **D2:** reminders are in-page only (partially meets ADR 0041).
- **D3:** no deposit claims.

**Decided 26 Sept 2026, recommended options, recorded in ADR 0090:** D5 (a), D6 N = 60, D7 90 days, D8 one account. The original questions follow for reference:
- **D5: How manual transfer is offered.**
  - (a) As a third option alongside card and Paystack transfer.
  - (b) Only as a fallback when Paystack transfer is unavailable.
- **D6: How long dates stay held while you verify.** The guest must transfer and upload within the 20-minute Payment Window (ADR 0044). After that, the dates stay held for up to **N minutes** while you check your bank. If you don't verify in time, the dates are released and the guest is refunded. Suggested N = 60, within 8 AM–8 PM WAT only.
- **D7: Receipt retention.** Suggested: keep receipts 90 days after the stay, then delete. Only you can view them.
- **D8: Which account guests pay into manually.** One fixed business account, with a unique booking reference the guest must include.

## Risks

- **Fake or reused receipts.** Mitigation: confirmation depends on the bank credit, not the image. Each booking has a unique reference and the exact amount.
- **You are a single point of failure** for both bottlenecks. The home page and reminders exist for this. Adding staff later is a new grant, not new code.
- **One file renders every back-office page** (`local-owner-server.ts`), so slices must take turns editing it (see the map).
