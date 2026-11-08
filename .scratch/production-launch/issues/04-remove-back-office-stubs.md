# Remove the production stubs in the back office

Status: ready-for-agent
Type: AFK
Blocked by: none
Requested: 8 Nov 2026
Wraps: [pilot-launch-readiness/20](../../pilot-launch-readiness/issues/20-remove-back-office-stubs.md) (its acceptance criteria apply; resolve both together)

## Parent

[PRD](../PRD.md), decision D6.

## Why

Operators decide on real Booking Requests from the back office. On main (16d592e) `apps/local-owner/src/local-owner-environment.ts` still hard-codes, in production composition:

- `trailing60dReliabilityRate: 0.98` (line 672) and the 12/12 reliability counts;
- `governmentIdVerified: true` (line 707);
- `phoneNumber: "+2348012345678"` (line 728).

An operator would call a fake number and see every guest as verified.

## What to build

See pilot-launch-readiness/20. In short: read guest contact from the stored guest contact, guest verification as ADR 0085 defines it at request time (verification moves to check-in), and operator reliability from stored bookings or the documented cold-start policy (ADR 0066, 0083). If an ADR leaves a value open, record the gap and ask the owner; do not invent one.

## Acceptance criteria

- [ ] AC1: The back office shows the guest's stored phone and email for a Booking Request, not a constant.
- [ ] AC2 failure path: a request with no stored contact shows that the contact is missing; it never shows a placeholder number.
- [ ] AC3: Guest verification at request time follows ADR 0085 and is never a hard-coded `true`.
- [ ] AC4: Operator reliability comes from stored bookings or the cold-start policy cited by ADR.
- [ ] AC5: A grep test fails if `+2348012345678` or `governmentIdVerified: true` appears in non-test production composition.

## ADRs to read

0066, 0083, 0085, 0086, 0091.

## Comments
