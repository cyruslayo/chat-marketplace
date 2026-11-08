# Refuse pilot units whose check-in window does not start at 14:00

Status: ready-for-agent
Type: AFK
Blocked by: 02 (decision 3)
Requested: 8 Nov 2026

## Parent

[PRD](../PRD.md), decision D7.

## Why

`domains/shortlet/src/booking-request.ts` enforces a fixed 10:55 WAT latest disclosure on the check-in date. ADR 0053 wants three hours before the unit's Contractual Check-In Window. The two agree only when the window starts at 14:00, which ADR 0031 sets for launch arrivals. Rather than build per-unit cutoffs now (`shortlet-concierge-launch/48`, post-launch), make it impossible to publish a unit that would break the equivalence.

## What to build

- Production inventory import (`/_ops/import` and the onboarding path) refuses a unit whose Contractual Check-In Window does not start at 14:00, with a closed reason naming the field.
- A note on `shortlet-concierge-launch/48` that this guard must be removed when 48 is built.

## Acceptance criteria

- [ ] AC1: A unit with a 14:00 window imports.
- [ ] AC2 failure path: a unit with any other start is refused with a closed reason and nothing is written.
- [ ] AC3: The demo CSV (`apps/cloudflare/demo/inventory.csv`) still imports.

## ADRs to read

0031, 0041, 0053.

## Comments
