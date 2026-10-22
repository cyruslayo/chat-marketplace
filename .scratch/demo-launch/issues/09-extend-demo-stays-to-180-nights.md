# Extend demo quotes and contracts through 180 nights

Status: ready-for-agent
Type: AFK
Blocked by: 08

## Parent

[Public Live Demo Launch PRD](../PRD.md)

## Why

The owner authorized synthetic staging demo bookings through 180 consecutive nights. ADR 0092's 30-night Billing Period and price rules remain unchanged.

## What to build

- Extend the working 30-night path from issue 08 to demo stays through 180 consecutive nights.
- Keep 30-night Billing Periods. A 180-night stay has six periods. A shorter final period uses nightly Owner's Agreed Amounts plus margin.
- Snapshot each period's dates, amounts, and nightly contracted values in the quote and Booking Contract.
- Preserve ADR 0055's 90-day check-in horizon and validate inspection, authority and regulatory claims through the final checkout.
- Keep the 180-night exception confined to staging demo mode and local demo verification. Production remains capped at 90 Extended Stay nights after its ordinary launch gates close.

## Acceptance criteria

- AC1: A six-period 180-night demo quote totals the six period amounts and snapshots all six periods.
- AC2: A quote for a length with a shorter final period uses the nightly price for only that final period, with exact nightly contracted values.
- AC3: Staging demo requests from 30 through 180 nights pass only for opted-in units with complete monthly pricing and utilities facts.
- AC4: Lengths of 15–29 or more than 180 nights are rejected before search results, quote, identity verification, hold or payment. A non-demo or production request over 90 nights is rejected.
- AC5: A check-in beyond the 90-day horizon or any checkout beyond inspection, authority or regulatory expiry is rejected at each required recheck point.
- AC6: Short Stay lengths, prices, horizon checks and anti-fragmentation behavior pass their existing tests unchanged.

## Validation

Create one named behavioral test per acceptance criterion, including each failure path. Use the real booking and storage compositions from issue 08. Run only affected Node, Worker and real-Chrome tests.

## ADR compliance

| ADR | Constraint | Affected path / criteria |
| --- | --- | --- |
| 0023 | Short Stays remain 1–14 nights; 15–29 nights stay unsupported | AC4, AC6 |
| 0055 | 90-day check-in horizon and validity rechecks | AC5 |
| 0056, 0057, 0009, 0065 | Inspection, authority and regulatory validity through checkout | AC5 |
| 0089, 0092 | Monthly amount, margin, period and shorter-final-period pricing | AC1–AC3 |
| 0105 | 180-night maximum applies only to synthetic staging demo bookings | AC3–AC4 |

## Source issues

- [Monthly-stays issue 04](../../monthly-stays/issues/04-extended-stay-eligibility.md)
- [Monthly-stays issue 05](../../monthly-stays/issues/05-monthly-price-and-utilities.md)

## Definition of Done

Use the repository checklist. Preserve all existing Short Stay tests unchanged. Run `npm run check` and the tests that cover this path. Record exact commands and counts in `## Comments`. Do not run the batch suites here.

## Comments
