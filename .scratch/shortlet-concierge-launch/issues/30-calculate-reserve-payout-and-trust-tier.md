# Calculate Rolling Reserve, Payout Plan, and Operator Trust Tier

Status: ready-for-agent
Type: AFK
User stories: 81–82, 90–91

## Parent

[Concierge Platform and Verified Shortlet Launch PRD](../PRD.md)

## What to build

Assign the accepted founding Payout Plan, retain and release Reserve Tranches, evaluate Proven and Preferred Operator Trust Tier progression from completed bookings and reliability, and override ordinary payout acceleration for open risk, liabilities, legal holds, or provider restrictions.

## Acceptance criteria

- [ ] Founding 90/10 and post-checkout choices, Proven 95/5, and Preferred terms use versioned provisional policy.
- [ ] Tier evaluation uses the accepted booking counts, observation periods, reliability thresholds, and enforcement state.
- [ ] Reserve and payout projections reconcile to ledger entries and never promise unavailable or legally held funds.
- [ ] Downgrade, open liability, appeal, adjustment, and duplicate-release cases are covered behaviourally.

## Blocked by

- [Issue 28](28-post-commission-and-revenue-release.md)
- [Issue 29](29-apply-graduated-operator-enforcement.md)
