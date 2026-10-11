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

## Open decisions (decided; see Human decisions in Comments)

1. **Default freshness duration.** Decided: no default. ADR 0094 requires an explicit authoritative `expiresAt`, and ADR 0084's proposed 180 days is not adopted. AC2 refuses a verified outcome without an explicit `expiresAt`. Nothing in this issue applies a freshness period.
2. **Account-merge re-verification trigger.** Decided: dropped. ADR 0094 does not authorise a merge of two Guest Accounts, and conflicting links fail closed. The trigger is not implemented.

Status: `resolved` (header), set once CI verify and browser passed on the final head. The status and the decisions above are consistent with the Answer.

## Comments

- 11 Oct 2026, ADR map (read before implementation: 0011, 0012, 0070, 0075, 0084, 0085, 0093, 0094; CONTEXT.md terms Identity Assurance, Guest Account, Linked Principal):
  - 0094, one result per `(tenant_id, account_guest_id)`; the table holds exactly the ADR fields (AC6 test: column set). Email change removes the current result (trigger `guest_identity_assurance_on_email_change`, AC3). Sign-in on another device does not (AC3 failure path). Expiry is lazy against the explicit `expiresAt` (AC2).
  - 0094 and 0084, `status` takes the ADR 0084 recorded states (`pending`, `verified`, `failed`, `expired`, `provider_unavailable`); `not_started` is never stored. Expired is also projected lazily.
  - 0094, Check-In resolution: Reservation -> Primary Guest -> Linked Principal -> Guest Account -> current result (`guest-check-in-eligibility.ts`). Missing account, tenant mismatch, expired and not verified are not eligible. No physical-access authority is granted.
  - 0011, 0075, the stored record holds no identity evidence, provider payload, score or secret (AC6 failure path). Operators get only `eligible` or a reason (`no_account`, `not_verified`, `expired`), never the method, reference or dates.
  - 0085, the assurance store and check-in helper are imported only by the files listed in the AC5 allowlist test. The booking closure (browse, listing details, ranking, availability, quote, booking request, conditional offer, payment modules) never reaches them.
  - 0084, the test-only fake records method `local-fixture` (`test/helpers/identity-assurance-fixture.ts`). It is a test fixture, not a provider method. The store accepts it only when constructed with `allowFixtureMethods`, which only test helpers set, and no non-test source imports it (AC5).
- 11 Oct 2026, human decisions applied (from the PR #99 Open-decisions answer, "go with your recommendations"): no default freshness period (AC2 refuses a verified outcome without an explicit `expiresAt`); the account-merge re-verification trigger is dropped (not implemented; ADR 0094 does not authorise a merge); ADR 0084's 180-day period is not adopted.
- 11 Oct 2026, personal-data classification (issue 05 precedent): `guest_identity_assurance` is exported in the daily export (`EXPORT_TABLES`, `apps/cloudflare/src/do-export.ts`) and is not a credential table. It holds personal data (account link, level, timestamps, opaque provider reference) and is flagged for the DPIA (issue 12a). Schema migration 4 in `apps/cloudflare/src/schema.ts` carries the same comment. Handled conservatively: exported and flagged for the DPIA like issue 05's tables, and not treated as a credential table. The final classification is a Needs-human item for the privacy review, because ADR 0075 reserves that determination for the DPIA and privacy review.
- 11 Oct 2026, Needs human (these parts are not decided here and are not implemented; they do not block the acceptance criteria above):
  1. Final classification of `guest_identity_assurance` (personal data or otherwise) by the DPIA and privacy review (ADR 0075). The table is handled conservatively in the meantime (see the previous entry).
  1a. Confirm the provider reference format and the digit-run screen at Smile onboarding (ADR 0084). Both are provisional conservative constants (see the Answer).
  2. ADR 0094 "Resolving a Reservation to an account" also allows a resource-scoped request claim (root Booking Request lineage). Not built: check-in resolution uses a Linked Principal only and fails closed as `no_account` otherwise. Decide whether this lands here or in a later check-in issue. It needs the reservation -> offer -> request lineage, which is not in this issue's "What to build".
  3. `GuestVerificationService.validateDisclosure` (`domains/shortlet/src/guest-verification.ts`) still calls `validateCheckInEligibility`, which reads identity verification on a disclosure path. ADR 0085 supersedes that requirement. It is not reached by production code (`BookingRequestManager` uses `validateBookingEligibility`), and `test/verify-primary-guest-payer-and-occupants.test.ts` depends on it, so it was left unchanged as this issue asks. Decide whether to retire or re-point it.
  4. `GuestIdentityResolver` (issue 05) still reports `email-verified` for every account, and the `GuestAssurance` type has no government-ID level. Surfacing the assurance level belongs with the account page and sign-in routes (issues 06 and 07), so it is not changed here.
  5. The local fake is not wired into the `.scratch/guest-ui-consistency` walkthrough, because the local guest composition is owned by issue 06.

- Human decisions (verbatim, as the coordinator recorded them):
  - 10 Oct 2026, the human replied "go with your recommendations" to a plan that stated: issue 09 drops the account-merge trigger; no default freshness period (use the explicit `expiresAt`, per ADR 0094).
  - 11 Oct 2026, the human replied "go with your recommendations" for the fix round that followed the independent review of PR #101 (head 5424cb1).
- 11 Oct 2026, review fix round (PR #101, head 5424cb1 to the fix commit):
  1. Barrel: `domains/shortlet/src/index.ts` no longer re-exports the store or the check-in helper. The AC5 sweep now resolves barrel re-exports and covers `domains`, `packages`, `apps/web/src`, `apps/local-guest/src`, `apps/pilot/src`, `apps/cloudflare/src`, `apps/local-owner/src`, `apps/shortlet-ops/src` and `scripts`. Probes M7, M8 and M10 now fail.
  2. Method and reference: `method` is an allowlist (ADR 0084's `nigeria_nin_v2_biometric_kyc`). The fixture method is accepted only when the store is constructed with `allowFixtureMethods`, which only test helpers do. `providerReference` must be an opaque reference: letters, digits, `_` and `-`, at most 64 characters, starting with a letter, with no run of 9 or more digits. The length bound is a storage bound, not a provider contract. The digit-run screen is conservative, because NIN, BVN and phone numbers are 10 to 11 digits (ADR 0075). The provider's format is to be confirmed at onboarding.
  3. Import: `guest_identity_assurance` is not refused by name, because the daily export includes it and a restore needs it. Each row in an ops import goes through the same rules as a recorded outcome, plus the active-account check (`identityAssuranceRowForImport`). A failing row refuses the whole batch with a generic message. The ops routes are behind `ops-auth.ts` (shared secret header or Cloudflare Access JWT), which this change does not touch. The fixture moved from `apps/local-guest/src` to `test/helpers/`. The AC5 sweep fails on any non-test source importing it (probe M9).
  4. Hardening: `currentAssurance` and `accountForPrincipal` require an active account. The claim path reads the owner with a lookup that ignores status, so a closed owner's requests are not claimed by a new account. `verifiedAt` cannot be later than the injected clock (required store option `clock`, no tolerance). A same-address write does not remove the outcome (test). The AC1 failure-path titles match their assertions.
- Scope note: the closed-account rule changes the issue 05 `accountForPrincipal` (a closed account's principals now resolve to no account). The resolver then returns the anonymous identity for them, which is the intended result. All issue 05 tests pass unchanged.


- Orchestrator decisions (delegated by the human, 11 Oct 2026; these are not human quotes and are not human-approved):
  1. `guest_identity_assurance` is handled conservatively, following the issue 05 precedent: exported, flagged for the DPIA, and not a credential table. The final classification is NOT decided here. It is a Needs-human item for the privacy review (ADR 0075 reserves that determination).
  2. Claim-based Reservation resolution (ADR 0094, root Booking Request lineage) is not built in issue 09. It belongs in the check-in wiring issue. Until then a principal not linked to an account fails closed as `no_account`.
  3. `GuestVerificationService.validateDisclosure` is left unchanged, because it has no production caller and `test/verify-primary-guest-payer-and-occupants.test.ts` depends on it. Follow-up: retire or re-point it when check-in wiring exists.
  4. Surfacing the government-ID level in the identity resolver (`domains/shortlet/src/guest-identity.ts`, which hardcodes `email-verified`) is assigned to issue 07. A one-line requirement is recorded in issue 07's Comments.
  5. The local fixture stays out of the walkthrough until issue 06 finishes local composition.

## Answer

Implemented on branch `ga-09-assurance-port` (PR #101), stacked on `ga-base-05-99` (PRs #100 and #99). Acceptance tests are in `test/guest-identity-assurance.test.ts` (37 tests), with the shared fixture in `test/helpers/guest-identity-assurance.ts` and the test-only fake in `test/helpers/identity-assurance-fixture.ts`. The Worker route status is pinned in `apps/cloudflare/test/identity-assurance-import.spec.ts`.

- Store and service: `domains/shortlet/src/guest-identity-assurance.ts`. `SqliteGuestIdentityAssurance(database, { clock, allowFixtureMethods? })` with `recordOutcome` (active same-tenant account required) and `currentAssurance(accountGuestId, tenantId, now)` (active accounts only; lazy expiry). A verified outcome needs an explicit `expiresAt`, and its `verifiedAt` cannot be later than the clock. An invalid clock is refused at both the store and the import boundary.
- Ops import: `identityAssuranceRowForImport` applies the same rules to each `guest_identity_assurance` row. It requires that the account exists in the same tenant, with any status, so a legitimately exported row restores after its account has closed. A missing account or another tenant's account is refused with a generic message. The batch is refused as `IDENTITY_ASSURANCE_REFUSED` (HTTP 400, no value named).
- Check-in helper: `domains/shortlet/src/guest-check-in-eligibility.ts`. Not imported by any route, and the barrel does not re-export it.
- Schema: migration 4 in `apps/cloudflare/src/schema.ts`. `guest_identity_assurance` is in `EXPORT_TABLES`.

Per acceptance criterion (test names mirror the criteria):
- AC1: "AC1: a recorded verified outcome is returned for the account from any linked principal"; "AC1 failure path: a principal not linked to the account gets null"; "AC1 failure path: a principal linked to a different account reads that account's empty result, never the verified one"; "AC1 failure path: a principal read under another tenant gets null"; "AC1 failure path: an outcome for an account that is not an active account of this tenant is refused"; "AC1: the test-only fixture records a verified outcome that the account-backed source returns".
- AC2: "AC2: an outcome whose explicit expiresAt has passed reads as expired at the next call without any background job"; "AC2 failure path: a verified outcome without an explicit expiresAt is refused, so no default expiry applies"; "AC2 failure path: a verified outcome with an invalid verifiedAt, or an expiry not later than verification, is refused"; "AC2 failure path: a stored verified result with no explicit expiry never reads as current".
- AC3: "AC3: changing the account email marks the outcome as needing re-verification"; "AC3 failure path: signing in on another device with the same account keeps the current outcome"; "AC3 failure path: a same-address change-email does not remove the outcome".
- AC4: "AC4: check-in eligibility fails closed for a Reservation whose Primary Guest has no account"; "AC4: check-in eligibility fails closed for an expired outcome"; "AC4 failure path: pending, failed, provider-unavailable and email-only outcomes are not eligible"; "AC4 failure path: a Reservation whose tenant differs from the account's tenant fails closed as no account"; "AC4 failure path: a Reservation without a tenant, Reservation id or Primary Guest is refused".
- AC5: "AC5: no booking, route, application or payment module reaches the eligibility helper or the assurance store, through barrels or direct imports"; "AC5: only the schema manifest, the import validator and the check-in helper import the assurance store, and nothing imports the eligibility helper"; "AC5: no non-test source imports this issue's test-only fixtures"; "AC5: the sweep covers every apps and packages source root, including apps/web-agent/src". The roots are read from the filesystem (`apps/*/src`, `packages/*/src`, `domains`, `scripts`).
- AC6: "AC6: the stored record holds only the ADR 0094 fields"; "AC6 failure path: identity evidence passed alongside an outcome is never stored"; "AC6 failure path: a level or status outside ADR 0094 and ADR 0084 is refused"; "AC6: the ADR 0084 method and an opaque provider reference are accepted"; "AC6 failure path: a method that is not a platform-owned identifier is refused, and the test fixture method is refused by the production store"; "AC6 failure path: a provider reference that looks like a restricted identifier is refused"; "AC6 failure path: an ops import cannot write a current verified row without the same validation"; "AC6: an ops import restores an identity assurance row for an active account and for a closed account of the same tenant"; "AC6 failure path: an ops import refuses a row for a missing account or another tenant's account, with a generic message"; "AC6 failure path: an ops import refuses a provider reference that hides a restricted digit run behind separators"; "AC6 failure path: the ops import route refuses an identity assurance row with 400 IDENTITY_ASSURANCE_REFUSED and no value" (Worker spec).
- Hardening (review, not an AC): "Hardening: a verifiedAt later than the injected clock is refused, and one equal to it is accepted"; "Hardening: a closed Guest Account has no current outcome and its principals resolve to no account"; "Hardening: a request whose principal belongs to a closed account is not claimed by a new account on the same email"; "Hardening: an invalid injected clock refuses recording and import rather than failing open".

Red and green:
- Second review round, red (the fixes not yet applied): 4 of 37 failed as expected: the separator-bypass refusal, the closed-account restore, the separator refusal on the import path, and the invalid-clock fail-open. The AC5 sweep's new root check was first written against the dynamic roots, so its red is captured by the probe below, not by this run. The Worker status spec pins the existing 400 mapping, so it passes on the old code by design.
- Green: 37 of 37 (node). `npm run check` exit 0. `npm run test:workers` 15 files, 86 tests pass. `npm run test:non-browser` 1524 of 1524.

Mutation probes (final code; scratchpad `ga09c-mutations.txt` and `ga09c-extra.py`): 38 probes (the 37 in the harness, plus M13 re-run). 37 are killed by a named test. The one survivor is P22 (a redundant `!tenantId || !guestId` guard), an equivalent mutation. M13 (digit screen removed) is killed by both separator tests. N1 (separator stripping removed), N2 (import requires an active account again) and N3 (clock guard removed) are killed. The web-agent sweep probe (an untracked module in `apps/web-agent/src` importing the helper) fails the reachability and importer tests on the dynamic roots. With the old hardcoded root list the same probe is missed by those tests, and only the sweep meta-test fails.

Known trade-offs and provisional constants (DoD item 5):
- The 64-character bound on `providerReference` and the 9-digit digit-run screen are provisional conservative constants, awaiting Smile onboarding. ADR 0084 defines no reference format, and NIN, BVN and phone numbers are 10 to 11 digits (ADR 0075).
- Separators (`-`, `_`) are stripped before the digit screen, so `a1234-5678-901` is refused. A legitimate provider reference with 9 or more digits in a row after stripping is refused too. That is the fail-closed trade-off until the format is confirmed.
- Otherwise the values come from ADR 0094 and 0084.

Definition of Done:
1. Named tests per AC: yes.
2. Failure paths tested and probed: yes.
3. ADRs read and cited (0011, 0012, 0070, 0075, 0084, 0085, 0093, 0094): yes.
4. No unused injected dependency: yes.
5. No invented policy: see the provisional constants above. The method allowlist and the status vocabulary come from ADR 0084 and 0094.
6. No credential or identity material in logs or audit: yes. The import refusal names no value, and the Worker spec checks that.
7. `npm run check`, `npm run test:workers`, `npm run test:non-browser` green on the final head. CI verify and browser: see the PR #101 body for the run URLs and conclusions.

CI classification (browser, run 38103569484, head e955504): attempt 1 failed on `test/guest-unit-detail-consistency-chromium.test.ts:28` (test "AC5: without JavaScript the unit page shows every photo and its request action still works", CDP error `Inspected target navigated or closed`). This branch does not touch the unit page. The same head passed on rerun (attempt 2, 164 pass, 0 fail, 1 skipped by design). Classified as a harness timing flake with thin evidence: one failed attempt and one passed attempt, and no repeated run.

Needs human (open questions, not resolved here):
1. The final personal-data classification of `guest_identity_assurance`, by the DPIA and privacy review (ADR 0075). It is handled conservatively until then.
2. Confirm the provider reference format, the 64-character bound and the 9-digit screen at Smile onboarding (ADR 0084).
3. Claim-based Reservation resolution, `validateDisclosure`, the resolver's government-ID level and the walkthrough wiring: the orchestrator decisions and follow-ups above.
