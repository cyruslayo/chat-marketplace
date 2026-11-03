# 04 Offer and payment clarity

Status: ready-for-agent
Type: task
Blocked by: 03

## What to build

Group offer terms for reading, while keeping material acceptance terms visible. Display one authoritative absolute WAT deadline. Label acceptance as continuation to payment choice. Present available methods together and show switching only when the current payment state permits it. Verify late-payment and refund language against the actual reconciliation path.

## Acceptance criteria

- AC1: Offer terms, final amount, separate deposit, and WAT deadline appear in clear order in chat and conventional routes; raw ISO and policy IDs are absent from guest-facing copy.
- AC2: Offer acceptance describes the immediate next step and never implies a Reservation or completed payment.
- AC3: Available methods form one accessible choice group; each restriction is adjacent to its method, and unavailable choices cannot start a payment.
- AC4: Handoff, pending, failed, expired, and reconciliation states show only actions authorized by current state; a pending attempt cannot offer a conflicting method switch.
- AC5: Late-payment wording matches verified implementation and policy; no automatic refund or booking revival is promised without authority.

## ADR map

0015/0016: all-in price and separate deposit. 0044/0049: payment window and hosted checkout. 0074: stale action. 0075: no sensitive payment data in logs. 0077: canonical facts. 0078: WAT and accessibility. 0080: conventional payment route. Read ADR 0087/0090 and other intersecting records before code.

## Tests and evidence

Write one named failing test per AC. Cover card, provider transfer, manual transfer, pending, failure, expiry, and stale actions. Run `npm run check`, affected tests and matching Worker specs only if Worker code changes. Run changed real-Chrome files separately. Capture four widths in light/dark and record exact checks and DoD in Comments.

## Comments
