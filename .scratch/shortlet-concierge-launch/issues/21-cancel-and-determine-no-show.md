# Cancel under the standardized catalogue and determine No-Show

Status: ready-for-agent
Type: AFK
User stories: 48–51

## Parent

[Concierge Platform and Verified Shortlet Launch PRD](../PRD.md)

## What to build

Calculate guest cancellation under the captured Flexible, Standard, or Firm policy using the Cancellation Base, apply failure and legal overrides, refund always-refundable components, and permit human-confirmed No-Show only after failed contact and the next-day 10:00 AM WAT deadline.

## Acceptance criteria

- [ ] Exact boundary tests cover every full, partial, and zero-refund threshold in all three policies.
- [ ] Deposit, duplicate payment, unprovided services, cleaning, and attributable refundable tax are excluded as required.
- [ ] Cancellation Liability selects the correct guest, Operator, platform, force-majeure, or legal funding outcome.
- [ ] Agent, conventional, and support cancellation paths produce the same calculation, command, ledger, and audit evidence.

## Blocked by

- [Issue 13](13-present-contract-and-release-arrival-data.md)
- [Issue 16](16-verify-access-with-live-support.md)
