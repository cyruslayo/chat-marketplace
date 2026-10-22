# Demo monthly cancellation, Notice to End and overdue handling

Status: ready-for-agent
Type: AFK
Blocked by: 09, 10, 11

## Parent

[Public Live Demo Launch PRD](../PRD.md)

## Why

An Extended Stay demo must explain changes and missed period payments. ADR 0092 contains numeric cancellation and Notice to End terms, but marks them as awaiting counsel approval.

## What to build

- Demonstrate only the existing ADR 0092 values for synthetic staging demo bookings. Identify the guest-facing values as demo terms. This exception does not close the counsel gate.
- Use the cancellation and amendment services, booking snapshots and period payment state. Do not add a second refund or adjustment model.
- Keep cancellation and early-departure decisions deterministic. Model output may explain results only.
- Project overdue Period Payment state from the clock. Direct the case to human contact. Never lock out the guest, change access, or run an end-of-stay process; the lawful process remains [counsel].
- Keep Short Stay cancellation behavior unchanged.

## Acceptance criteria

- AC1: Before check-in, a demo Extended Stay cancellation applies ADR 0092's T-30/T-14 values to the first Period Payment and never charges unpaid later periods.
- AC2: The cancellation entry is snapshotted at request and contract creation, so a later catalogue change does not change an existing booking.
- AC3: A 14-day Notice to End records a versioned Booking Amendment, sets the last night from the notice date, settles only through that date, and refunds paid nights after it at the contract's nightly values.
- AC4: Operator, platform or safety failure uses ADR 0061's remedy path and never falls through to the voluntary Notice to End rules.
- AC5: A missed due date projects an overdue state and requests human contact. It never changes access or automatically ends the stay.
- AC6: The guest sees demo wording for the cancellation and Notice to End values. The screen does not state or imply that counsel approved them.
- AC7: Existing Short Stay cancellation and Notice to End tests pass unchanged. Named tests cover every criterion and failure path.

## ADR compliance

| ADR | Constraint | Affected path / criteria |
| --- | --- | --- |
| 0014, 0058 | Versioned cancellation catalogue and deterministic result | AC1–AC2 |
| 0060 | Booking Amendments are versioned and atomic | AC3 |
| 0061 | Failure remedies override voluntary departure | AC4 |
| 0075 | Keep credentials and restricted identity data out of output and logs | AC1–AC7 |
| 0092 | T-30/T-14 demo cancellation, 14-day Notice to End, overdue handling; lawful termination remains counsel-gated | AC1–AC5 |
| 0105 | Synthetic staging demo may demonstrate ADR 0092 values with clear demo wording | AC6 |

## Source issues

- [Monthly-stays issue 08](../../monthly-stays/issues/08-cancellation-and-notice-to-end.md)
- [Monthly-stays issue 06](../../monthly-stays/issues/06-billing-periods-and-period-payments.md)

## Definition of Done

Use the repository checklist. Preserve all existing Short Stay tests unchanged. Run `npm run check` and the tests that cover this path. Record exact commands and counts in `## Comments`. Do not run the batch suites here.

## Comments
