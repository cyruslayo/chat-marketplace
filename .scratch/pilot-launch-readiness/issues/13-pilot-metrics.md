# Define and capture pilot metrics

Status: resolved
Type: task
Blocked by: 01

## What to build

A simple report (command line or back office) from the pilot database, so any decision to scale rests on real numbers.

## Acceptance criteria

- [x] Requests received, share confirmed, and median time to confirm.
- [x] Payments started, completed, expired and refunded, by payment method.
- [x] Check-ins with Verified Access, incidents per stay, and relocations and refunds with amounts.
- [x] Margin earned, and owner payables due and paid (ADR 0089).
- [x] Metric names are defined in `domains/shortlet/CONTEXT.md` before use.

## Comments

- 2026-11-08 (agent): Resolved by [production-launch/09](../production-launch/issues/09-pilot-metrics-for-operators.md) at commit `ad27c23`. The back-office page `GET /operator/metrics` reads the authoritative store on Node and the Worker and defines every metric name in `domains/shortlet/CONTEXT.md` ("Pilot metrics").
- Requests, payments by method, Verified Access check-ins, incidents per stay, refunds by stage, margin earned and owner payables due/paid/not yet due are all from durable records.
- **Relocations are reported unavailable with a reason, never as zero**, because no durable production record or wiring exists; the owner decision on that source is open. Refund amounts are separated into paid-to-Guest, decided-by-policy and recorded-for-refund so the same money is not presented as one settled total.

## Answer

The pilot report is the operator-authenticated pilot metrics page at `GET /operator/metrics`, with definitions in `domains/shortlet/CONTEXT.md`. All five criteria are exercised by named tests; relocations remain explicitly unavailable pending the owner's source decision.
