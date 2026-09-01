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

- **Mandatory Committed Accounting Repository & Release**: Settlement calculation strictly requires an authoritative `ProductionRevenueReleaseRecord`, an authoritative `RevenueAccountingRepository`, and mandatory reliability and enforcement authorities. Projections are never produced for uncommitted or free-floating objects; missing any source fails closed.
- **Reconciliation from CURRENT Accumulated Ledger State**: `ReservePayoutManager` derives current balances across `operator_payable`, `rolling_reserve`, `post_stay_deferred`, `risk_restricted`, and `operator_costs_and_offsets` by folding all committed journals for the release. The sum of settlement balances strictly reconciles to authoritative Operator Net.
- **Target Derivation & Bi-directional Ledger Adjustments**: Computes target settlement allocations strictly from authoritative Trust Tier, the immutable release's `payoutPlan`, server time (+24h checkout for Full Post-Stay), and active holds. Upward and downward tier transitions (Preferred -> Standard on downgrade, Standard -> Proven, Proven -> Preferred, Full Post-Stay -> Preferred) and hold applications/clearances post balanced, correlated ledger adjustments to `RevenueAccountingRepository`. Payout projections strictly equal the final matching ledger balances.
- **Ledger-Reconciled Holds**: Open liabilities, active risk conditions, appeals, and pending adjustments restrict settlement into the `risk_restricted` ledger account rather than mutating projections without backing journals. Clearing restrictions restores the applicable Trust Tier classification.
- **Natural Idempotency**: Repeated evaluations compare current folded ledger state with the target; matching states post zero adjustments. Transition adjustment IDs incorporate deterministic history digests to allow cyclical transitions (Preferred -> Standard -> Preferred) safely without collisions or duplicate ledger movements.
- **Mandatory Authoritative Operator Scope**: Payout hold commands require a mandatory `OperatorScopeAuthority`, failing closed if absent, for unknown operators, or for cross-tenant attempts.
- **Platform Commands & Human Authority**: Consequential overrides and release actions require `PlatformCommandEnvelope` with valid idempotency keys and authorized human roles (`admin` or `authorized_staff`), strictly rejecting AI/agent decisions and conflicting idempotency key reuse.
- **Local Owner Demonstration**: The local apartment owner test surface exercises the genuine `RevenueReleaseManager.commitProductionRelease()` path into `InMemoryRevenueAccountingRepository`, feeds the resulting committed record into `ReservePayoutManager`, and verifies that the owner's ordinary 100% Preferred settlement projection reconciles with committed ledger adjustments.

### Validation

Full automated verification: `npm run check` clean; `test/calculate-reserve-payout-and-trust-tier.test.ts` passes 4/4 dedicated criterion tests; full test suite passes.

### ADR Compliance

- ADR 0024: One immutable Revenue Release; reserve movements and settlement reclassifications post explicit, balanced ledger adjustments.
- ADR 0026 & ADR 0063: Provisional Payout Plans (90/10 Fast Payout, Full Post-Stay, Proven 95/5, Preferred) and 30-day review points.
- ADR 0062: Founding commercial cohort status remains distinct from Trust Tier; commission rates (8%/10%/12%) remain immutable.
- ADR 0064: Authoritative enforcement state overrides commercial progression.
- ADR 0072 & ADR 0083: Human-authorized commands with idempotency, mandatory authoritative operator scope, and strict concurrency.
- ADR 0075: Minimized, tenant-scoped projections without exposing internal risk scores or secrets.
