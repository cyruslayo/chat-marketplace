# Period Owner Payable

Status: ready-for-agent
Type: task
Blocked by: 06

## What to build

Owners of an Extended Stay are paid one period at a time. Extend `domains/shortlet/src/owner-payable.ts`; don't create a parallel model.

- Capture one **Period Owner Payable** per Billing Period in the booking snapshot at confirmation. Each equals the owner's agreed amounts for that period (the Monthly Agreed Amounts for a full period; the nightly Owner's Agreed Amounts for each night of a shorter final period, ADR 0092) and is never recalculated (ADR 0089).
- Period 1 becomes due under ADR 0089: 24 hours after Verified Access, with no Blocking Fulfilment Complaint open. Each later period becomes due under ADR 0092: when its Period Payment is verified and its first night has begun, with no Blocking Fulfilment Complaint open.
- An unpaid or ended period's payable never becomes due.
- A Notice to End or cancellation (issue 08) changes a period's payable only as the policy outcome determines.
- Owner Payouts are recorded per period: date, amount, reference. The existing Owner Overpayment rule applies per booking.
- The back office per booking shows each period's amount received, Period Owner Payable, margin, due status and paid status.

## Acceptance criteria

- AC1: Confirmation snapshots one Period Owner Payable per period, and later changes to the unit configuration do not alter them.
- AC2: Period 1's payable becomes due 24 hours after Verified Access and not while a Blocking Fulfilment Complaint is open.
- AC3: A later period's payable becomes due only when those ADR 0092 conditions hold, and never for an unpaid or ended period.
- AC4: The margin for a period is earned when that period's payable becomes due.
- AC5: Recording an Owner Payout against a period stores its date, amount and reference. Payouts over the payable surface as an Owner Overpayment.

## ADR compliance

| ADR | Constraint |
|---|---|
| 0089 | Owner Payable captured at confirmation; due-time rule; manual payouts; margin earned with payable |
| 0092 | "Paying owners" per-period due rule |
| 0014 | Changes only through the policy outcome |

## Definition of Done

See `docs/agents/issue-tracker.md`.

## Comments
