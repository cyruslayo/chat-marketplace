# Monthly price: Monthly Agreed Amounts, margin and what's included

Status: ready-for-agent
Type: task
Blocked by: 03

## What to build

Price an Extended Stay from versioned unit configuration, using the ADR 0089 model.

- Unit configuration gains **Monthly Agreed Amounts**: the owner's agreed amount per Billing Period, plus any mandatory charges. These are versioned like today's Owner's Agreed Amounts in `domains/shortlet/src/owner-terms.ts`. The unit's margin rate applies on top.
- Unit configuration gains a **utilities and servicing statement**: which of power and generator fuel, water, internet and cleaning are included, and the cleaning frequency. Store these as structured facts, not free text (ADR 0092, "Units" and "Price").
- `quote.ts` produces an Extended Stay quote with:
  - one All-In Stay Total for the whole stay;
  - a per-period breakdown (dates, amount);
  - a nightly contracted value for every night (ADR 0092, "Price").
  The quote is time-limited and versioned like today (ADR 0015).
- A missing monthly amount or utilities statement means the unit is not available for Extended Stays. Missing pricing means unavailable (ADR 0055).

## Acceptance criteria

- AC1: For an opted-in unit, an Extended Stay quote's All-In Stay Total equals the sum of its periods, and each full period equals the Monthly Agreed Amounts plus margin, and a shorter final period equals the unit's nightly Owner's Agreed Amounts plus margin for each of its nights (ADR 0092).
- AC2: The nightly contracted values in every period add up to that period's amount exactly, in kobo, with no rounding loss.
- AC3: A unit missing Monthly Agreed Amounts or a utilities statement produces no Extended Stay quote and is not offered for Extended Stay dates.
- AC4: Changing a unit's Monthly Agreed Amounts or margin affects only new quotes. A captured quote or contract is never recalculated.
- AC5: The quote carries the unit's utilities and servicing facts, so the guest sees what is included before requesting.

## ADR compliance

| ADR | Constraint |
|---|---|
| 0089 | Owner's agreed amounts plus margin; versioned configuration |
| 0015 | One all-in total; no late mandatory charges; quotes versioned and time-limited |
| 0092 | Billing Period, nightly contracted value, utilities statement |
| 0061 | Remedies use nightly contracted value |

## Definition of Done

See `docs/agents/issue-tracker.md`.

## Comments
