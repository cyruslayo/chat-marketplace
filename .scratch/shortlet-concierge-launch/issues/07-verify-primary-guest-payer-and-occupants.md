# Verify the Primary Guest, payer, and occupants

Status: ready-for-agent
Type: AFK
User stories: 14–17

## Parent

[Concierge Platform and Verified Shortlet Launch PRD](../PRD.md)

## What to build

Collect the Primary Guest, named overnight occupants, government-ID verification status, Self-Booking attestation, and any permitted distinct-payer attribution before a Booking Request can be disclosed. Keep restricted identity evidence outside general interaction state.

## Acceptance criteria

- [ ] Unverified Primary Guests and prohibited third-party bookings cannot progress to disclosure.
- [ ] Occupancy and named-occupant rules are checked against Unit capacity and policy.
- [ ] A permitted distinct payer requires the accepted attestations and cannot replace the Primary Guest.
- [ ] Restricted identity data is minimized, tenant-scoped, redacted, and never exposed through ordinary AG-UI/A2UI state.

## Blocked by

- [Issue 02](02-resume-an-authenticated-interaction-thread.md)
