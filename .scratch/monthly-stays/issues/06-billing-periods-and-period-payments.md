# Billing Periods and Period Payments

Status: ready-for-agent
Type: task
Blocked by: 04, 05

## What to build

An Extended Stay is paid one Billing Period at a time.

- **Confirmation.** The first Period Payment goes through the existing Payment Window and Live Payment Attempt rules and the existing methods: card, Paystack transfer and manual transfer (ADRs 0044, 0046, 0088, 0090). Verifying it forms the Booking Contract and blocks the whole stay. The contract snapshots every period's dates, amount, due date and nightly contracted values.
- **Later periods.** Each later Period Payment is its own payment session under the same rules: a unique reference, one live attempt, and backend verification only. Its due date and reminders come from ADR 0092: payable once the previous period has started, due 7 days before its first night, reminders 7, 3 and 1 days before.
- **Missed payment.** If a Period Payment is not verified by its due date, the period becomes **overdue** and goes to the back office for human contact. If it is still unpaid when the period starts, ADR 0092 "Missed payment" applies (the lawful process is [counsel]). Nothing locks the guest out automatically.
- **Late money.** Money for a period that has already been ended under ADR 0092 "Missed payment" is recorded and fully refunded and never revives the period (ADR 0045).
- **State.** Period state (scheduled → due → paid / overdue → ended) is projected lazily against the clock in `projectState`. Do not rely on a background job to flip it (AGENTS.md anti-pattern 2).
- **Back office.** The back office lists upcoming and overdue Period Payments by due date.

## Acceptance criteria

- AC1: Verifying the first Period Payment confirms an Extended Stay once, blocks every night of the stay, and snapshots all periods.
- AC2: An unverified or mismatched first Period Payment confirms nothing and releases inventory at the Payment Window deadline, exactly as for a Short Stay.
- AC3: A later Period Payment can be started only for the next unpaid period of a confirmed Extended Stay, and only one live attempt exists for it.
- AC4: A verified later Period Payment marks only that period paid. A duplicate or superseded success is recorded for refund.
- AC5: A period with no verified payment at its due date projects as overdue from the clock, with no background job, and appears in the back-office list.
- AC6: An overdue period still unpaid at its start follows ADR 0092 "Missed payment". No automatic lockout or access change is issued.
- AC7: Money arriving for a period already ended is recorded for full refund and changes no stay state.
- AC8: Reminders are produced 7, 3 and 1 days before the due date (ADR 0092), and they contain no credentials, account numbers or identity evidence (ADR 0075).

## ADR compliance

| ADR | Constraint |
|---|---|
| 0092 | 30-night Billing Periods, due 7 days before, reminders 7/3/1, missed payment |
| 0044, 0046 | Payment Window; one live attempt per session |
| 0045 | Late money refunded, never confirms |
| 0088, 0090 | Methods; manual transfer verified against the credit |
| 0075 | No secrets in reminders or logs |

## Definition of Done

See `docs/agents/issue-tracker.md`.

## Comments
