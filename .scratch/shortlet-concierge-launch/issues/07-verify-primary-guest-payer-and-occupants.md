# Verify the Primary Guest, payer, and occupants

Status: resolved
Type: AFK
User stories: 14–17

## Parent

[Concierge Platform and Verified Shortlet Launch PRD](../PRD.md)

## What to build

Collect the Primary Guest, named overnight occupants, government-ID verification status, Self-Booking attestation, and any permitted distinct-payer attribution before a Booking Request can be disclosed. Keep restricted identity evidence outside general interaction state.

## Acceptance criteria

- [x] Unverified Primary Guests and prohibited third-party bookings cannot progress to disclosure.
- [x] Occupancy and named-occupant rules are checked against Unit capacity and policy.
- [x] A permitted distinct payer requires the accepted attestations and cannot replace the Primary Guest.
- [x] Restricted identity data is minimized, tenant-scoped, redacted, and never exposed through ordinary AG-UI/A2UI state.

## Completion note

Issue 07 is implemented with authoritative Primary Guest verification
before Booking Request disclosure. Disclosure binds the authenticated
principal and trusted tenant to the Primary Guest, requires a trusted
government-ID verification result, enforces structured/versioned
Self-Booking and permitted distinct-payer attestations, and validates
the complete named overnight-occupant roster against Unit capacity.
Restricted identity evidence remains outside ordinary interaction/A2UI
state and requires complete SecurityContext plus explicit authorization
for raw reads and writes. Canonical minimized Primary Guest, occupant,
and distinct-payer data flows through Booking Request and Conditional
Offer, while card and bank payment verification enforce the authorized
payer without allowing a distinct payer to replace the Primary Guest.

Validation: 333 tests passed, 0 failed across 4 suites; focused Issue 07,
Booking Request, Conditional Offer, card-payment, and bank-transfer
tests, Weaver vendor verification, and TypeScript checks passed.

## Blocked by

- [Issue 02](02-resume-an-authenticated-interaction-thread.md)
