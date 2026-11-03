# 05 Confirmation hierarchy

Status: ready-for-agent
Type: task
Blocked by: 04

## What to build

Lead with the authoritative Reservation status, verified stay payment, separately collected deposit, reference, and arrival actions. Put full contract terms in a labeled details area. Keep physical access readiness distinct from booking confirmation. Use the same facts in chat and conventional pages.

## Acceptance criteria

- AC1: Confirmed state presents Reservation, Unit, dates, party, verified amounts, and reference in the same order across both channels; no unverified payment can render it.
- AC2: Arrival information and support remain easy to find, while full terms remain accessible in details without repeating the entire receipt.
- AC3: A confirmed Reservation does not claim physical access authority; 320px and screen-reader views retain all material facts.

## ADR map

0005: Reservation follows verified payment. 0015/0016: stay total and deposit distinct. 0077: canonical cross-channel facts. 0078: reflow and accessibility. 0080: conventional confirmation route. Read other intersecting ADRs before code.

## Tests and evidence

Write one named failing test per AC, including unverified payment and missing-access failure paths. Run `npm run check` and affected tests. Capture four widths in light/dark; test screen reader and 200% zoom. Record exact commands, pass counts, and DoD review in Comments.

## Comments
