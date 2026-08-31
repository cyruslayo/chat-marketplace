# Establish Operator Trust Tier and settlement policy

## Context

Issue 30 requires a normative contract for Operator Trust Tier evaluation and settlement availability. ADR 0063 establishes the Proven and Preferred booking windows and reserve terms but leaves the required reliability thresholds unstated. The existing Issue 30 implementation uses 0.95 and 0.98 as undocumented constants. This decision makes those intended launch values explicit without implementing Issue 30.

Trust Tier is distinct from the provisional Founding commercial cohort. Settlement policy must also consume the immutable Revenue Release established by Issue 28 rather than create a second financial source of truth.

## Decision

### Trust Tier and Founding status

Operator Trust Tier is one of:

- `standard`
- `proven`
- `preferred`

Founding is a separate provisional commercial cohort under ADR 0062. A Founding Operator may have any applicable Trust Tier. Trust Tier never infers or recalculates commission; commission remains the captured Revenue Release economics under ADR 0062.

### Proven eligibility

Proven requires all of the following in the trailing 60 elapsed days:

- at least 10 completed platform bookings;
- at least 95% authoritative platform-observed reliability; and
- no active enforcement state that blocks commercial progression; and
- no current payout restriction that independently blocks improved terms.

The 95% reliability threshold is a provisional launch policy.

### Preferred eligibility

Preferred requires all of the following in the trailing 180 elapsed days:

- at least 30 completed platform bookings;
- at least 98% authoritative platform-observed reliability; and
- no active enforcement state that blocks commercial progression; and
- no current payout restriction that independently blocks improved terms.

The 98% reliability threshold is a provisional launch policy. Preferred is evaluated before Proven. Failure to qualify for Preferred does not prevent qualification for Proven when the Proven gates are met.

### Reliability authority

Trust Tier evaluation consumes an authoritative platform-owned reliability projection, not a caller assertion, LLM score, or off-platform reputation. The minimum Issue 30 application contract is an authoritative reliability rate for the required observation window together with its qualifying opportunity and completion evidence.

The authoritative source must use platform-observed evidence, exclude platform and provider faults, distinguish extraordinary events from Operator misconduct, deduplicate one underlying incident from downstream reports, and remain tenant- and Operator-scoped. This ADR does not define the complete reliability aggregation implementation.

### Downgrade and enforcement override

Trust Tier is derived from current authoritative evidence and may downgrade at the next evaluation when its booking-count or reliability gate is no longer met. Active enforcement that blocks commercial progression immediately overrides Proven or Preferred for new settlement decisions. Historical bookings and historical Revenue Releases are never rewritten by a downgrade.

### Settlement terms

Settlement classification applies after the booking's single authoritative Revenue Release. It does not create a second Revenue Release or alter captured commission, commission base, commission rate, taxes, Operator Net, or booking offsets.

For a Standard/Founding launch Operator:

- Fast Payout makes 90% of authoritative Operator Net settlement-eligible after Revenue Release and classifies 10% to a booking-specific Rolling Reserve. The reserve tranche is eligible for review 30 days after authoritative checkout.
- Full Post-Stay Payout uses no routine percentage reserve and makes 100% settlement-eligible 24 hours after authoritative checkout. Funds must not be described as payable before that time.

For a Proven Operator, 95% of authoritative Operator Net is settlement-eligible after Revenue Release and 5% is classified to a booking-specific Rolling Reserve. The tranche uses the same 30-day-after-checkout reserve review point unless a stronger risk restriction applies.

For a Preferred Operator, 100% of authoritative Operator Net is ordinarily settlement-eligible after Revenue Release and no routine percentage reserve is required. This does not guarantee immediate transfer or eliminate open risk, liabilities, legal holds, PSP/provider restrictions, or other accepted holds.

Settlement eligibility is an extension of account settlement policy, not a Trust Tier commission rule. Founding cohort status and Trust Tier must be represented separately.

### Revenue Release and ledger authority

The Issue 30 runtime consumes the immutable Revenue Release from Issue 28. It must not independently recalculate or rewrite commission base, commission rate, commission, Operator Net, taxes, or booking offsets. Trust-tier settlement changes occur through settlement classification and explicit balanced ledger adjustments after or alongside the Release.

Every financial projection must reconcile to authoritative ledger state. An amount is not settlement-eligible unless the ledger classification makes it available. Movements among `operator_payable`, `rolling_reserve`, `post_stay_deferred`, `risk_restricted`, and `operator_costs_and_offsets` require balanced, correlated financial records. `ReservePayoutManager` must not maintain a second independent money truth.

### Reserve review and release

Reserve maturity creates eligibility for review, not unconditional payment. Reserve release or liability application fails closed while any relevant condition remains open, including Operator liability, a relevant financial or risk appeal, legal hold, PSP/provider restriction, active risk restriction, or a pending authoritative adjustment that could affect the tranche.

A reserve release or liability application records an explicit balanced ledger adjustment. Mutating only an in-memory tranche is not a financial movement.

### Commands, idempotency, and human authority

Consequential reserve-release, liability-application, and payout-hold commands require real idempotency keys. Replaying the same command must not create duplicate financial movements; conflicting idempotency-key reuse fails closed.

AI, agent, and system principals cannot make final payout-hold, reserve-forfeiture, or other consequential financial decisions. Existing accepted platform human roles and command-specific authorization apply; this ADR introduces no new finance RBAC system.

## Provisional status

The following remain provisional launch policy pending PSP, finance, legal, operator-interview, and loss-model validation:

- 95% Proven reliability;
- 98% Preferred reliability;
- 10 bookings / 60 days for Proven;
- 30 bookings / 180 days for Preferred;
- 90/10 Fast Payout;
- 95/5 Proven settlement;
- 100% ordinary Preferred settlement access; and
- the 30-day reserve review point.

## Consequences

Issue 30 has a defined source contract for tier evaluation, settlement classification, and reserve handling. Its runtime must still be repaired to consume authoritative reliability, Revenue Release, and ledger state. The existing `reserve-payout-trust.ts` implementation is not accepted as proof of those requirements merely because it contains matching provisional constants.

## ADR compliance

- ADR 0024: one immutable Revenue Release; later changes use explicit ledger adjustments.
- ADR 0026: founding payout choices, reserve treatment, improved terms, and risk restrictions remain versioned policy.
- ADR 0062: Founding is separate from Trust Tier and commission remains captured Revenue Release economics.
- ADR 0063: booking windows and provisional financial protection terms are made operationally explicit here.
- ADR 0064: enforcement can override commercial progression; human financial decisions remain separate.
- ADR 0072: consequential settlement commands require server-side authorization, validation, concurrency, and idempotency.
- ADR 0075: projections and records must minimize restricted identity and financial data.
