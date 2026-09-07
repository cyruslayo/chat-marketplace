# Move Guest Identity Verification enforcement to Check-In

## Context

The pilot needs to test the Shortlet booking marketplace without introducing
online KYC infrastructure. ADR-0011 placed Guest Identity Verification before
Booking Request disclosure, which made identity assurance a Booking Eligibility
condition. The pilot instead needs booking authority and physical-access
authority to remain separate.

## Decision

For the pilot, Guest Identity Verification is not Booking Eligibility. It is
Check-In Eligibility.

An unverified Guest may discover a Unit, inspect it, create and review a
Request Draft, disclose a Booking Request, receive Operator confirmation,
accept a Conditional Booking Offer, pay, and form a valid Reservation, provided
all other authoritative booking requirements pass. No identity check or hidden
bypass may be added to those stages.

Guest Identity Verification is required before physical access authority is
granted. The future enforcement sequence is:

`Reservation → Check-In Eligibility → Human-Assisted Identity Verification → Access Authorization`

The verification may occur during pre-arrival, arrival, or in-person check-in.
The operational procedure is intentionally deferred. The application must not
grant a door access code, lockbox code, smart-lock credential, key-release
authorization, protected entry instruction, or equivalent physical access
authority merely because a Reservation exists.

Until the future check-in decision exists, protected arrival data is released
fail closed. A Reservation summary may exist without implying physical-access
eligibility.

The existing `GuestIdentityVerificationResultSource` remains a provider-neutral
platform port for future check-in use. This decision does not add an identity
provider, document upload, NIN or BVN collection, selfie or biometric capture,
verification dashboard, vendor adapter, or automated identity-verification
workflow. Booking storage continues to contain no raw identity evidence;
future check-in verification should persist normalized outcomes and opaque
references only where required.

## Supersession

This ADR supersedes the part of ADR-0011 that requires government-ID
verification before Booking Request disclosure. ADR-0011's minimization,
operator redaction, reusable assurance, and additional-occupant principles
remain useful where applicable to future check-in eligibility.

It also defers activation of ADR-0084's provider-selection and booking-flow
implementation assumptions until a separate check-in/access decision authorizes
them. ADR-0084's provider research is not an integration or launch dependency
for this pilot.

## Consequences

- Booking Request eligibility no longer reads Guest Identity Verification state.
- Self-Booking, payer, availability, stay, quote, timing, inspection,
  Management Authority, and applicable risk rules remain enforced.
- Conventional and Weaver presentations use the same identity-independent
  booking boundary.
- Booking telemetry must not classify missing identity verification as a
  booking failure.
- Check-in verification and access authorization remain future work; no detailed
  human procedure is defined here.
