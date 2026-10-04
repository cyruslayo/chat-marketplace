# ADR 0094: Anchor identity assurance to the Guest Account

Status: ready-for-agent
Type: task
Blocked by: 02
Requested: 2 Oct 2026

## Why

The user wants the account system to support identity verification when it is integrated. ADR 0084 (provider) and ADR 0085 (enforcement at check-in) say what is verified and when, but not *what it is attached to*. Today `GuestIdentityVerificationResultSource.getVerificationResult({ tenantId, guestId })` (`domains/shortlet/src/guest-verification.ts:29`) is keyed by a throwaway session principal, so a result could never be reused.

## What to build

- `docs/adr/0094-anchor-identity-assurance-to-the-guest-account.md`, recording:
  - Identity Assurance belongs to the Guest Account (`accountGuestId`), never to a session principal, thread or booking
  - the levels from issue 01 (anonymous, email-verified, phone-verified, government-ID-verified) and that only normalized outcomes and opaque provider references are stored (ADR 0085 "Booking storage continues to contain no raw identity evidence")
  - reuse only until authoritative `expiresAt`; require `verifiedAt` and `expiresAt`, and do not adopt ADR 0084's proposed 180-day duration without approval; re-verification triggers include verified-email change, revocation and material risk changes
  - scoped email recovery does not merge accounts or move assurance; a scoped claim resolves only through its Reservation lineage
  - check-in eligibility reads the account behind the Reservation's Primary Guest; a Reservation with no account fails closed (per issue 01 answer 3)
  - operators receive only the minimal outcome they need (ADR 0011), never evidence
  - this ADR adds no provider, form, upload or biometric capture (ADR 0085 stays in force)
- `domains/shortlet/CONTEXT.md`: refine **Identity Assurance** if issue 02 left it general.

## Acceptance criteria

- AC1: ADR 0094 exists and cites 0011, 0012, 0084 and 0085; it states it does not supersede 0085.
- AC2: The ADR names exactly what is stored per assurance record (fields) and what is never stored.
- AC3: The ADR says how a Reservation made without an account becomes eligible for check-in verification (claim path from issue 01).

## Tests to add/update

None (documentation).

## ADR compliance

0011, 0012, 0070, 0075, 0084, 0085.
