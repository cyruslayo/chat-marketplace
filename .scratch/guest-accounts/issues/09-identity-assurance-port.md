# Identity-assurance port on the Guest Account

Status: resolved
Type: task
Blocked by: 03, 05
Requested: 2 Oct 2026

## Why

This is the piece that makes the account ready for identity checks (the user's requirement). When Smile ID (ADR 0084) or a human-assisted check (ADR 0085) is added later, its result must land on the account and be reused while fresh, and check-in must be able to ask "is the person behind this Reservation verified?" without any booking-stage check.

## What to build

- An Identity Assurance record per account, stored as ADR 0094 specifies: level, method, `verifiedAt`, `expiresAt`, opaque provider reference, status. Nothing else (no NIN, BVN, images, scores).
- A store and a small service: `recordOutcome`, `currentAssurance(accountGuestId, tenantId, now)`. Expiry is evaluated lazily against the explicit authoritative `expiresAt` (AGENTS anti-pattern 2); no default freshness period is approved. Reject verified outcomes without valid explicit `verifiedAt` and `expiresAt`.
- `GuestIdentityVerificationResultSource` (`domains/shortlet/src/guest-verification.ts:29`): an account-backed implementation that maps a Primary Guest id to its account (via Linked Principals) and returns the current result. A Primary Guest with no account returns `null`.
- Email change (issue 07) removes the current assurance result, so re-verification is required (ADR 0094). The account-merge trigger is **not authorised** by ADR 0094 and is not implemented here; see Open decisions.
- Check-in eligibility helper (no UI): `Reservation → account → current assurance`. Returns not-eligible for no account, expired, or not verified. It is not called anywhere in discovery, request, offer or payment.
- A local fake that records a verified outcome, for tests and the walkthrough only.

## Acceptance criteria

- AC1: A recorded verified outcome is returned for the account from any linked principal. Failure path: a principal not linked to the account gets `null`.
- AC2: An outcome whose explicit `expiresAt` has passed reads as expired at the next call without any background job. No default expiry is applied (see Open decisions).
- AC3: Changing the account email marks the outcome as needing re-verification.
- AC4: Check-in eligibility fails closed for a Reservation whose Primary Guest has no account, and for an expired outcome.
- AC5: No discovery, request, offer or payment code path imports the eligibility helper (a test asserts the import graph or greps the modules).
- AC6: The stored record holds only the ADR 0094 fields.

## Tests to add/update

New `test/guest-identity-assurance.test.ts`. Re-run `test/verify-access-with-live-support.test.ts` (Primary Guest authorization) unchanged.

## ADR compliance

0011, 0070, 0075, 0084, 0085, 0094.

## Open decisions (needs human decision)

1. **Default freshness duration.** Not approved. ADR 0094 requires an explicit authoritative `expiresAt` and says no default freshness duration is approved; ADR 0084's proposed 180 days is not adopted. Recommended: no default, `expiresAt` always explicit. Do not code a default until a human decides.
2. **Account-merge re-verification trigger.** Not authorised by ADR 0094, which says a merge of two Guest Accounts is not authorised and conflicting links fail closed. Recommended: drop the trigger. Needs human decision before it is implemented.

Status is left as `ready-for-agent` (the decision is not a triage state change in this doc pass); the implementer should not start AC2 or the merge trigger until these are decided.

## Comments

- 11 Oct 2026, ADR map (read before implementation: 0011, 0012, 0070, 0075, 0084, 0085, 0093, 0094; CONTEXT.md terms Identity Assurance, Guest Account, Linked Principal):
  - 0094, one result per `(tenant_id, account_guest_id)`; the table holds exactly the ADR fields (AC6 test: column set). Email change removes the current result (trigger `guest_identity_assurance_on_email_change`, AC3). Sign-in on another device does not (AC3 failure path). Expiry is lazy against the explicit `expiresAt` (AC2).
  - 0094 and 0084, `status` takes the ADR 0084 recorded states (`pending`, `verified`, `failed`, `expired`, `provider_unavailable`); `not_started` is never stored. Expired is also projected lazily.
  - 0094, Check-In resolution: Reservation -> Primary Guest -> Linked Principal -> Guest Account -> current result (`guest-check-in-eligibility.ts`). Missing account, tenant mismatch, expired and not verified are not eligible. No physical-access authority is granted.
  - 0011, 0075, the stored record holds no identity evidence, provider payload, score or secret (AC6 failure path). Operators get only `eligible` or a reason (`no_account`, `not_verified`, `expired`), never the method, reference or dates.
  - 0085, the assurance store and check-in helper are imported only by the files listed in the AC5 allowlist test. The booking closure (browse, listing details, ranking, availability, quote, booking request, conditional offer, payment modules) never reaches them.
  - 0084, the local fake records method `local-fixture` (`apps/local-guest/src/identity-assurance-fixture.ts`). It is a test and walkthrough fixture, not a provider method, and no production composition imports it.
- 11 Oct 2026, human decisions applied (from the PR #99 Open-decisions answer, "go with your recommendations"): no default freshness period (AC2 refuses a verified outcome without an explicit `expiresAt`); the account-merge re-verification trigger is dropped (not implemented; ADR 0094 does not authorise a merge); ADR 0084's 180-day period is not adopted.
- 11 Oct 2026, personal-data classification (issue 05 precedent): `guest_identity_assurance` is exported in the daily export (`EXPORT_TABLES`, `apps/cloudflare/src/do-export.ts`) and is not a credential table. It holds personal data (account link, level, timestamps, opaque provider reference) and is flagged for the DPIA (issue 12a). Schema migration 4 in `apps/cloudflare/src/schema.ts` carries the same comment. This follows the precedent and is listed under Needs human for confirmation.
- 11 Oct 2026, Needs human (these parts are not decided here and are not implemented; they do not block the acceptance criteria above):
  1. Confirm the DPIA classification of `guest_identity_assurance` (see the previous entry).
  2. ADR 0094 "Resolving a Reservation to an account" also allows a resource-scoped request claim (root Booking Request lineage). Not built: check-in resolution uses a Linked Principal only and fails closed as `no_account` otherwise. Decide whether this lands here or in a later check-in issue. It needs the reservation -> offer -> request lineage, which is not in this issue's "What to build".
  3. `GuestVerificationService.validateDisclosure` (`domains/shortlet/src/guest-verification.ts`) still calls `validateCheckInEligibility`, which reads identity verification on a disclosure path. ADR 0085 supersedes that requirement. It is not reached by production code (`BookingRequestManager` uses `validateBookingEligibility`), and `test/verify-primary-guest-payer-and-occupants.test.ts` depends on it, so it was left unchanged as this issue asks. Decide whether to retire or re-point it.
  4. `GuestIdentityResolver` (issue 05) still reports `email-verified` for every account, and the `GuestAssurance` type has no government-ID level. Surfacing the assurance level belongs with the account page and sign-in routes (issues 06 and 07), so it is not changed here.
  5. The local fake is not wired into the `.scratch/guest-ui-consistency` walkthrough, because the local guest composition is owned by issue 06.

## Answer

Implemented on branch `ga-09-assurance-port`, stacked on `ga-base-05-99` (PRs #100 and #99). Acceptance tests live in `test/guest-identity-assurance.test.ts` (22 tests), with the shared fixture in `test/helpers/guest-identity-assurance.ts`.

- Store and service: `domains/shortlet/src/guest-identity-assurance.ts` (`SqliteGuestIdentityAssurance.recordOutcome` and `currentAssurance(accountGuestId, tenantId, now)`, lazy expiry, fail-closed projection of malformed rows) and `AccountBackedGuestIdentityVerificationResultSource` (the port in `guest-verification.ts`).
- Check-in helper: `domains/shortlet/src/guest-check-in-eligibility.ts` (`GuestCheckInIdentityEligibility.evaluate`). Not called by any route.
- Schema: migration 4 in `apps/cloudflare/src/schema.ts`, the table in `EXPORT_TABLES`.

Per acceptance criterion:
- AC1: `AC1: a recorded verified outcome is returned for the account from any linked principal`; `AC1 failure path: a principal not linked to the account gets null`; `AC1 failure path: a principal read under another tenant gets null`; `AC1 failure path: an outcome for an account that is not an active account of this tenant is refused`; `AC1: the local fake records a verified outcome that the account-backed source returns`.
- AC2: `AC2: an outcome whose explicit expiresAt has passed reads as expired at the next call without any background job`; `AC2 failure path: a verified outcome without an explicit expiresAt is refused, so no default expiry applies`; `AC2 failure path: a verified outcome with an invalid verifiedAt, or an expiry not later than verification, is refused`; `AC2 failure path: a stored verified result with no explicit expiry never reads as current`.
- AC3: `AC3: changing the account email marks the outcome as needing re-verification`; `AC3 failure path: signing in on another device with the same account keeps the current outcome`.
- AC4: `AC4: check-in eligibility fails closed for a Reservation whose Primary Guest has no account`; `AC4: check-in eligibility fails closed for an expired outcome`; `AC4 failure path: pending, failed, provider-unavailable and email-only outcomes are not eligible`; `AC4 failure path: a Reservation whose tenant differs from the account's tenant fails closed as no account`; `AC4 failure path: a Reservation without a tenant, Reservation id or Primary Guest is refused`.
- AC5: `AC5: no discovery, request, offer or payment code path imports the eligibility helper or the assurance store` (transitive closure from the booking modules); `AC5: only the assurance module, the check-in helper, the barrel, the schema and the local fake import the guarded modules` (allowlist of direct importers).
- AC6: `AC6: the stored record holds only the ADR 0094 fields`; `AC6 failure path: identity evidence passed alongside an outcome is never stored`; `AC6 failure path: a level or status outside ADR 0094 and ADR 0084 is refused`.

Also re-run unchanged: `test/verify-access-with-live-support.test.ts` (passes). Changed: `test/guest-account-linking.test.ts` pins `SHORTLET_SCHEMA_VERSION` to 4 (was 3, now that migration 4 exists).
