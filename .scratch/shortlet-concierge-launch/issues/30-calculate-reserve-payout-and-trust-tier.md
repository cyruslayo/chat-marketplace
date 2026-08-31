# Calculate Rolling Reserve, Payout Plan, and Operator Trust Tier

Status: resolved
Acceptance: 4/4 acceptance criteria satisfied.
Type: AFK
User stories: 81–82, 90–91

## Parent

[Concierge Platform and Verified Shortlet Launch PRD](../PRD.md)

## What to build

Assign the accepted founding Payout Plan, retain and release Reserve Tranches, evaluate Proven and Preferred Operator Trust Tier progression from completed bookings and reliability, and override ordinary payout acceleration for open risk, liabilities, legal holds, or provider restrictions.

## Acceptance criteria

- [x] Founding 90/10 and post-checkout choices, Proven 95/5, and Preferred terms use versioned provisional policy.
- [x] Tier evaluation uses the accepted booking counts, observation periods, reliability thresholds, and enforcement state.
- [x] Reserve and payout projections reconcile to ledger entries and never promise unavailable or legally held funds.
- [x] Downgrade, open liability, appeal, adjustment, and duplicate-release cases are covered behaviourally.

## Policy prerequisite

Issues 28 and 29 are resolved. Issue 30 production work is governed by ADR-0083 (Operator Trust Tier and settlement policy), ADR-0024, ADR-0026, ADR-0062, ADR-0063, ADR-0064, ADR-0072, and ADR-0075.

## Blocked by

- [Issue 28](28-post-commission-and-revenue-release.md)
- [Issue 29](29-apply-graduated-operator-enforcement.md)

## Answer

Productionized as an authoritative, ledger-integrated reserve and settlement path under ADR-0083.

- **Authoritative Revenue Release Integration**: `ReservePayoutManager` consumes the immutable `ProductionRevenueReleaseRecord` from Issue 28 rather than maintaining an independent calculation of commission, commission base, taxes, or Operator Net.
- **Trust Tier Evaluation**: Evaluates `preferred` (>=30 completed bookings in trailing 180 days, >=98% authoritative platform reliability) prior to `proven` (>=10 completed bookings in trailing 60 days, >=95% authoritative platform reliability), falling back to `standard`. Active enforcement state or admin hold immediately overrides tier progression.
- **Ledger-Reconciled Reserve Movements**: Tranche maturity creates review eligibility rather than automatic payout. Normal reserve releases and liability forfeitures post balanced, correlated ledger adjustments to `RevenueAccountingRepository` (moving funds between `rolling_reserve`, `operator_payable`, and `operator_costs_and_offsets`) and assign durable `ledgerJournalId`s.
- **Fail-Closed Hold Overrides**: Payout acceleration and tranche releases fail closed when open risk, open liabilities, legal holds, provider restrictions, active risk restrictions, pending adjustments, or pending appeals exist.
- **Platform Commands & Human Authority**: Consequential overrides and release actions require `PlatformCommandEnvelope` with valid idempotency keys and authorized human roles (`admin` or `authorized_staff`), strictly rejecting AI/agent decisions and conflicting idempotency key reuse.

### Validation

Full automated verification: `npm run check` clean; `test/calculate-reserve-payout-and-trust-tier.test.ts` passes 4/4 dedicated criterion tests; full test suite passes.

### ADR Compliance

- ADR 0024: One immutable Revenue Release; reserve movements post explicit, balanced ledger adjustments.
- ADR 0026 & ADR 0063: Provisional Payout Plans (90/10 Fast Payout, Full Post-Stay, Proven 95/5, Preferred) and 30-day review points.
- ADR 0062: Founding commercial cohort status remains distinct from Trust Tier; commission rates (8%/10%/12%) remain immutable.
- ADR 0064: Authoritative enforcement state overrides commercial progression.
- ADR 0072 & ADR 0083: Human-authorized commands with idempotency and strict concurrency.
- ADR 0075: Minimized, tenant-scoped projections without exposing internal risk scores or secrets.
