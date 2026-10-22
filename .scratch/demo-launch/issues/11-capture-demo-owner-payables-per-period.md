# Capture demo Owner Payables per Billing Period

Status: ready-for-agent
Type: AFK
Blocked by: 10

## Parent

[Public Live Demo Launch PRD](../PRD.md)

## Why

A six-period booking needs an immutable Owner Payable for each period. One booking-level payable would not represent the per-period price and payment schedule.

## What to build

- Extend the existing `owner-payable.ts` path and booking snapshot. Do not create a parallel payable model.
- Capture one Period Owner Payable per Billing Period at confirmation, using the agreed monthly amount for full periods and nightly amounts for a shorter final period.
- Keep ADR 0089 for Period 1. Keep ADR 0092 for later periods: paid, started and no Blocking Fulfilment Complaint.
- Record payouts per period and preserve the existing Owner Overpayment rule.

## Acceptance criteria

- AC1: Confirmation captures one immutable Period Owner Payable for each of six periods.
- AC2: Period 1 becomes due only under ADR 0089's Verified Access rule and when no Blocking Fulfilment Complaint is open.
- AC3: A later period becomes due only after its payment is verified, its first night has started, and no Blocking Fulfilment Complaint is open.
- AC4: An unpaid or ended period never earns its payable or margin.
- AC5: Payout records bind to one period, and a payout over that period's payable surfaces as an Owner Overpayment.
- AC6: The same owner-payable projection runs through Node and Cloudflare storage. Existing Short Stay payable tests pass unchanged.

## Validation

Create one named behavioral test per acceptance criterion, including each failure path. Run the affected Node and Worker tests. Run a real-Chrome test only if this issue changes a back-office screen.

## ADR compliance

| ADR | Constraint | Affected path / criteria |
| --- | --- | --- |
| 0089 | Capture Owner Payables at confirmation; Period 1 timing; manual payout; margin | AC1, AC2, AC5 |
| 0092 | Later Period Owner Payable timing and no payable for unpaid periods | AC1–AC4 |
| 0014 | Cancellation changes payables only through the policy result | AC4 |
| 0075 | Logs and audit records omit credentials and financial references | AC5 |
| 0095 | Tenant SQLite remains authoritative | AC6 |

## Source issues

- [Monthly-stays issue 07](../../monthly-stays/issues/07-period-owner-payable.md)

## Definition of Done

Use the repository checklist. Preserve all existing Short Stay tests unchanged. Run `npm run check` and the tests that cover this path. Record exact commands and counts in `## Comments`. Do not run the batch suites here.

## Comments
