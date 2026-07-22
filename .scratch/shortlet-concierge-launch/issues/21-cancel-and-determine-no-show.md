# Cancel under the standardized catalogue and determine No-Show

Status: resolved
Type: AFK
User stories: 48–51

## Parent

[Concierge Platform and Verified Shortlet Launch PRD](../PRD.md)

## What to build

Calculate guest cancellation under the captured Flexible, Standard, or Firm policy using the Cancellation Base, apply failure and legal overrides, refund always-refundable components, and permit human-confirmed No-Show only after failed contact and the next-day 10:00 AM WAT deadline.

## Acceptance criteria

- [x] Exact boundary tests cover every full, partial, and zero-refund threshold in all three policies.
- [x] Deposit, duplicate payment, unprovided services, cleaning, and attributable refundable tax are excluded as required.
- [x] Cancellation Liability selects the correct guest, Operator, platform, force-majeure, or legal funding outcome.
- [x] Agent, conventional, and support cancellation paths produce the same calculation, command, ledger, and audit evidence.

## Blocked by

- [Issue 13](13-present-contract-and-release-arrival-data.md)
- [Issue 16](16-verify-access-with-live-support.md)

## Answer

Implemented `CancellationNoShowManager` in `domains/shortlet/src/cancellation-noshow.ts`.

### ADR Compliance
- **ADR 0014**: Standardized Flexible, Standard, Firm policies; captured at request creation time; immutable; cash refunds return to original source.
- **ADR 0015 & ADR 0016**: Excluded security deposits, cleaning fees, unprovided optional services, duplicate payments, and attributable taxes from Cancellation Base.
- **ADR 0058**: Boundary tests for Flexible (T-72h 100%, T-24h 50%), Standard (T-14d 100%, T-7d 50%), Firm (T-30d 100%, T-14d 50%). No-Show determination requires human confirmation and 10:00 AM WAT deadline on day after arrival.
- **ADR 0072 & ADR 0080**: Deterministic parity across agent, web, and support channels using `cancellation.process` command envelope.

