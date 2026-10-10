# What you owe each owner

Status: ready-for-agent
Type: task
Blocked by: 05, guest-payments P4

## What to build

A Payouts page, per owner and per booking, shows:
- the amount received;
- the owner payable and your margin (captured at confirmation, guest-payments P4);
- the due date (24 hours after Verified Access with no Blocking Fulfilment Complaint);
- the status: not yet due, due, paused, or paid.

You record a payout with its date, amount and reference. Totals per owner show due now, paid, and not yet due. Refunds and cancellations change the payable only as the cancellation policy outcome determines.

## Acceptance criteria

- AC1: Each booking shows the amount received, the owner payable, your margin, the due date and the status (not yet due, due, paused, or paid), all from the booking snapshot and the ledger.
- AC2: For each owner, the page totals what is due now, what has been paid, and what is not yet due.
- AC3: You can record a payout for a due payable with its date, amount and reference; paying one not yet due, paying more than is due, or paying twice is refused.
- AC4: A booking cancelled or refunded under its cancellation policy shows the owner payable that policy outcome leaves, and a paused payable (an open blocking complaint) cannot be paid.

## ADR compliance

| ADR | Constraint |
|---|---|
| 0089 | owner payable captured at confirmation; due timing; paid by you; margin is your revenue |
| 0014 | cancellation policy outcome |
| 0072 | idempotent payout recording |
| 0075 | no owner bank details in logs |

## Definition of Done

- [ ] Every AC has one named test (name mirrors the criterion) and named failure paths are asserted.
- [ ] Every action asserts the standard failure paths: revoked or expired grant, no session, cross-origin POST, and a stale or expired target.
- [ ] Relevant ADRs were re-read and mapped above; non-obvious constraints cited at the callsite.
- [ ] No invented policy strings: money, deadline and legal wording traces to CONTEXT.md or an ADR; gaps raised with the user.
- [ ] No keys, secrets, receipts, account numbers or contact values in logs or telemetry (ADR 0075).
- [ ] Walkthrough at 320px, 375px and 1280px, and without JavaScript.
- [ ] `npm run check` and `npm test` pass.
