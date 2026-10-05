# Identity-assurance port on the Guest Account

Status: ready-for-agent
Type: task
Blocked by: 03, 05
Requested: 2 Oct 2026

## Why

This is the piece that makes the account ready for identity checks (the user's requirement). When Smile ID (ADR 0084) or a human-assisted check (ADR 0085) is added later, its result must land on the account and be reused while fresh, and check-in must be able to ask "is the person behind this Reservation verified?" without any booking-stage check.

## What to build

- An Identity Assurance record per account, stored as ADR 0094 specifies: level, method, `verifiedAt`, `expiresAt`, opaque provider reference, status. Nothing else (no NIN, BVN, images, scores).
- A store and a small service: `recordOutcome`, `currentAssurance(accountGuestId, tenantId, now)`. Expiry is evaluated lazily against the explicit authoritative `expiresAt` (AGENTS anti-pattern 2); no default freshness period is approved. Reject verified outcomes without valid explicit `verifiedAt` and `expiresAt`.
- `GuestIdentityVerificationResultSource` (`domains/shortlet/src/guest-verification.ts:29`): an account-backed implementation that maps a Primary Guest id to its account (via Linked Principals) and returns the current result. A Primary Guest with no account returns `null`.
- Email change (issue 07) and account merge mark assurance for re-verification per ADR 0084.
- Check-in eligibility helper (no UI): `Reservation → account → current assurance`. Returns not-eligible for no account, expired, or not verified. It is not called anywhere in discovery, request, offer or payment.
- A local fake that records a verified outcome, for tests and the walkthrough only.

## Acceptance criteria

- AC1: A recorded verified outcome is returned for the account from any linked principal. Failure path: a principal not linked to the account gets `null`.
- AC2: An outcome past its freshness period reads as expired at the next call without any background job.
- AC3: Changing the account email marks the outcome as needing re-verification.
- AC4: Check-in eligibility fails closed for a Reservation whose Primary Guest has no account, and for an expired outcome.
- AC5: No discovery, request, offer or payment code path imports the eligibility helper (a test asserts the import graph or greps the modules).
- AC6: The stored record holds only the ADR 0094 fields.

## Tests to add/update

New `test/guest-identity-assurance.test.ts`. Re-run `test/verify-access-with-live-support.test.ts` (Primary Guest authorization) unchanged.

## ADR compliance

0011, 0070, 0075, 0084, 0085, 0094.
