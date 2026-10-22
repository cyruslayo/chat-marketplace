# Pay each demo Billing Period through a separate payment session

Status: ready-for-agent
Type: AFK
Blocked by: 09

## Parent

[Public Live Demo Launch PRD](../PRD.md)

## Why

An Extended Stay can last six Billing Periods. The existing booking flow supports one payment, so later periods need persisted payment state and server-side verification.

## What to build

- Keep the first Period Payment on the existing Payment Window and Live Payment Attempt path.
- Add a separate payment session for each later Billing Period. Only the next unpaid period may be paid, and only one live attempt may exist for it.
- Follow ADR 0092: a later period becomes payable once the previous period has started; its payment is due seven days before its first night, with reminders seven, three and one days before.
- Persist payment attempts and verification results in the Cloudflare Durable Object and Node authority. Do not introduce recurring charges, saved cards, automatic lockouts or a second ledger.
- Keep provider verification server-authoritative. Use only Paystack test mode for staging.

## Acceptance criteria

- AC1: Verifying the first Period Payment confirms the stay once and snapshots every Billing Period from issue 09.
- AC2: The next unpaid period accepts one new live attempt only after it becomes payable. A future period or a second live attempt is refused.
- AC3: A valid verified payment marks only its period paid. Replaying the same valid webhook is idempotent and does not cause a refund.
- AC4: A separate successful attempt that was superseded is recorded for refund and does not advance the period.
- AC5: Missing, wrong, late or mismatched provider verification pays no period and preserves the contract state.
- AC6: Period due dates and 7/3/1-day reminders follow ADR 0092. Reminder records contain no credentials, account numbers or identity evidence.
- AC7: Each period becomes overdue lazily from the clock and appears in the authenticated back-office list.
- AC8: An overdue unpaid period requires human contact. The system never changes access, locks out the guest, or ends the stay automatically. The lawful process remains counsel-gated.
- AC9: The payment path survives Durable Object and Node restarts. Existing Short Stay payment tests pass unchanged.

## Validation

Create one named behavioral test per acceptance criterion, including each failure path. Cover both storage compositions and the actual payment verification path with stubbed TEST responses. Run only affected Node, Worker and real-Chrome tests.

## ADR compliance

| ADR | Constraint | Affected path / criteria |
| --- | --- | --- |
| 0044, 0046 | Payment Window and one live attempt per period | AC1–AC4 |
| 0045 | Late verified money is refunded and never revives an ended period | AC3–AC4 |
| 0075 | No payment credentials or identity evidence in reminders or logs | AC5 |
| 0087, 0088, 0090 | Server verification and existing payment methods; staging uses test mode | AC1–AC4 |
| 0092 | One Billing Period at a time, due date and reminders | AC1–AC5 |
| 0095 | Durable Object SQLite is authoritative in Cloudflare | AC6 |

## Source issues

- [Monthly-stays issue 06](../../monthly-stays/issues/06-billing-periods-and-period-payments.md)

## Definition of Done

Use the repository checklist. Preserve all existing Short Stay tests unchanged. Run `npm run check` and the tests that cover this path. Record exact commands and counts in `## Comments`. Do not run the batch suites here.

## Comments
