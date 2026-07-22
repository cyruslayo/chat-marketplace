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

Implemented `ProtectionFundManager` in `domains/shortlet/src/protection-fund-remedy.ts` and test suite `test/account-for-a-protection-fund-remedy.test.ts`.

Key architectural compliance:
- **ADR 0027 & ADR 0063**: Implemented versioned policy (`gpf-v1.0-launch`) governing seed capital calculation (`max(₦5m, 3*P95, 1% GBV)`), 10% earned commission contribution (2% after target), double-entry balanced ledger entries, tiered approval validation, and Finance exposure reporting without PII or interaction chat text.
- **ADR 0028 & ADR 0029**: Insufficient fund balance preserves approved guest remedy and guarantees Refund Fallback workflow.

