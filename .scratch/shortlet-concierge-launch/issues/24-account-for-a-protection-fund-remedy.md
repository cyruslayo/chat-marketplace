# Fund and account for an approved Guest Protection Fund remedy

Status: resolved
Type: AFK
User stories: 56–57, 89, 91

## Parent

[Concierge Platform and Verified Shortlet Launch PRD](../PRD.md)

## What to build

Fund an approved guest remedy from the Guest Protection Fund when ordinary recovery is unavailable, record the contribution, exposure, payment, Operator liability, and recovery rights, and prevent the fund from replacing ordinary responsible-party obligations.

## Acceptance criteria

- [x] Seed, contribution, target, approval, and available-balance rules use versioned provisional policy.
- [x] Every movement posts balanced ledger entries with incident, booking, decision, and funding correlation.
- [x] Insufficient fund balance does not erase the approved guest remedy or Refund Fallback workflow.
- [x] Finance can see exposure and recovery without accessing unrelated interaction or identity data.

## Blocked by

- [Issue 23](23-let-the-guest-choose-relocation-or-refund.md)
- [Issue 28](28-post-commission-and-revenue-release.md)

## Answer

Productionized and hardened the Guest Protection Fund through `ProtectionFundApplication`, `InMemoryProtectionFundAccountingRepository`, and the Issue 23 relocation funding port.

The production path binds seed, dynamic target, contribution, approval, and balance decisions to versioned provisional policy `gpf-v1.0-launch` and trusted metrics. Seed capital is obtained from a trusted platform-capital provider; contributions consume Issue 28's immutable `EarnedCommissionSource`, with one contribution per earned-commission record. Shared atomic accounting records balanced, correlated journals and survives application recreation.

GPF-funded relocation now requires a mandatory funding port, exact Issue 23 case, reservation, and case-version binding. Current relocation state, operator responsibility, and a complete liability decomposition are required. The Fund reserves the exact bridge amount before replacement fulfilment. Insufficient balance produces no deduction or false disbursement and preserves automatic original-source Refund Fallback. Successful replacement settles the exact reservation; failed fulfilment releases it idempotently. Completed relocation remains recorded when Fund settlement requires reconciliation.

Settlement recognizes the Operator recovery receivable as a debit asset and clears the committed-remedy account. Trusted recovery is accepted only after settled Fund movement, is bounded by the receivable, and is idempotent. Platform-caused and unresolved funding routes do not debit GPF. Finance authorization is mandatory and fails closed for all read and manual seed/recovery paths.

Finance receives a minimized read-only conventional projection at `/finance/guest-protection-fund` and Weaver A2UI Basic Catalog v0.9.1 projection. No guest identity, access evidence, complaint content, approver identity, payment data, credentials, or session data is projected.

Validation was local: 436 passed, 0 failed, 0 skipped, 0 todo; `npm run check`, `npm run verify:weaver`, and `git diff --check` passed (delta 0 from the 436-test baseline).

