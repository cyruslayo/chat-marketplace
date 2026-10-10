# Define and capture pilot metrics

Status: ready-for-agent
Type: task
Blocked by: 01

## What to build

A simple report (command line or back office) from the pilot database, so any decision to scale rests on real numbers.

## Acceptance criteria

- [ ] Requests received, share confirmed, and median time to confirm.
- [ ] Payments started, completed, expired and refunded, by payment method.
- [ ] Check-ins with Verified Access, incidents per stay, and relocations and refunds with amounts.
- [ ] Margin earned, and owner payables due and paid (ADR 0089).
- [ ] Metric names are defined in `domains/shortlet/CONTEXT.md` before use.
