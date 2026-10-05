# Guest account authority: codes, accounts, sessions

Status: resolved
Type: task
Blocked by: 02
Requested: 2 Oct 2026

## Why

The domain needs one authority that issues and checks Sign-In Codes, finds or creates Guest Accounts, and issues, resolves and revokes Guest Account Sessions. The Operator equivalent already exists and is the pattern to follow.

## What to build

- `domains/shortlet/src/guest-account-authority.ts`, exported from `domains/shortlet/src/index.ts`. Model it on `SqliteOperatorSessionAuthority` (`domains/shortlet/src/operator-session-authority.ts`): `BEGIN IMMEDIATE` transactions, `#now()` clock guard, `#emit` to optional audit and telemetry sinks that can never block auth, hashed secrets.
   - Policy values from ADR 0093 are constructor options with the ADR values as defaults (AGENTS anti-pattern 3), not literals in logic. Include purpose-bound `delete_account` and `export_data` proofs and the supplemental checking quotas.
   - Tables: `guest_accounts` (id, tenant, normalized email, phone, status, timestamps, revision), `guest_sign_in_codes` (opaque challenge id, HMAC code hash, tenant/email/purpose, bound account/session/revision for action codes, timestamps, attempts, consumption/invalidation state), `guest_account_sessions` (session id, secret hash, account/tenant, absolute timestamps and revocation), and pseudonymous persisted rate events keyed by a stable HMAC scope. The low-entropy code hash is not a global primary key.
   - `requestCode({ tenantId, email, purpose, clientAddress, ...sessionBinding })`: normalizes with `normalizeContactEmail` (`domains/shortlet/src/guest-contact.ts`), stores only the purpose/context-bound HMAC hash, returns the plain code once for immediate delivery, enforces configured send limits, and invalidates a prior challenge only after a permitted request. Sign-in has the same outcome shape whether or not an account exists.
   - `verifyCode({ challengeId, tenantId, email, code, purpose, clientAddress, ...sessionBinding })`: checking quotas apply across purposes and tenant contexts; wrong-attempt and rate events commit even when verification is refused. Sign-in success consumes atomically, finds or creates the account, and issues a new session. Action purposes issue no sign-in session; their proof is bound to account/session/revision and consumed once.
   - `resolveSession(sessionId, secret)`: returns the authenticated account/tenant/session principal or `null`; `sessionRejection` provides `missing`, `expired` or `revoked` only for a matching secret.
   - `revokeSession(sessionId, tenantId)`, `revokeAllSessions(accountGuestId, tenantId)`.
   - `changeEmail`: requires a consumed `change_email` proof sent to the *new* address, its live bound session and revision; bumps `revision` and invalidates other pending account action codes.
- Commands that change account state go through platform command envelopes (ADR 0072), following the envelope shape used by `VerifiedStayReviewManager.submitReview`.
- Audit entries: type, `accountGuestId`, tenant, reason code. Never email, code, secret or session id value.

## Acceptance criteria

- AC1: A code verified within its lifetime creates an account on first use and returns a session. Failure paths: expired code, consumed code, unknown email/code pair all fail and create no session.
- AC2: After the configured number of wrong attempts the code fails even when the right code is then entered.
- AC3: Two concurrent verifications of one code produce exactly one session.
- AC4: `requestCode` returns the same outcome shape and audit type for a known and an unknown email.
- AC5: A resolved session past its absolute expiry, or revoked, is rejected; `revokeAllSessions` rejects every session of that account and no other account's.
- AC6: A cross-tenant lookup (right code, wrong tenant) fails closed.
- AC7: No audit or telemetry entry contains the email, the code, the session secret or the session id (assert over every emitted entry in the test run).
- AC8: Changing email needs a code sent to the new address; the old email no longer signs in.
- AC9: Restarting (new authority instance on the same database) preserves valid, expired and revoked state.

## Tests to add/update

New `test/guest-account-authority.test.ts`, mirroring the Operator authority tests. Shared fixtures go in `test/helpers/` (AGENTS anti-pattern 4).

## ADR compliance

0070, 0072, 0075, 0086 (pattern), 0093.

## Comments

- 4 Oct 2026 ADR map: 0070 — account/domain/session identities remain separate and sessions are absolute/revocable (account and session rows); 0072 — account email changes require an authenticated, tenant-scoped, versioned `guest_account.change_email` command envelope (mutation boundary); 0075 — one-time codes, session secrets, email and session IDs never enter audit/telemetry (hashing and safe transition events); 0086 — reuse SQLite/clock/audit patterns but not Operator's token delivery or 12-hour session policy (constructor and expiry); 0093 — six-digit emailed codes, purpose-bound challenges, 30-day absolute Guest sessions and approved send/check quotas (authority defaults and validation).
- 4 Oct 2026 validation: `npm run check` passed; all 14 tests in `test/guest-account-authority.test.ts` passed; `git diff --check` passed. `npm test` completed with phase 1 at 1238/1242 and phase 2 at 164/165. Its failures are outside account authority: the `guest-must-fix-ux` production flow gets 409 instead of 303 (two subsequent assertions cascade), `onboard-and-publish-one-inspected-unit` fails its publication-eligibility assertion, and `discovery-phase3-chromium` cannot write evidence because `.scratch/ui-phase3-discovery-detail` is absent when it runs. The two independent phase-1 failures were reproduced at baseline commit `c6bad10` in an isolated temporary worktree, as was the guest-must-fix failure when run alone. Keep this issue claimed until the repository test gate is green or the baseline failures are resolved.
- Follow-up: fixed the time-dependent Guest UX fixture by freezing its clock at the fixture-valid date and selecting the request created by that journey; pinned the onboarding projection test clock; made the Chromium evidence helper create its output directory; scheduled focus after layout and awaited focus target in Chromium new-conversation test; waited for Paystack checkout redirect in real browser test. The complete `npm test` suite passed with zero failures on 5 October 2026.

## Answer

- Implemented `SqliteGuestAccountAuthority` and types in `domains/shortlet/src/guest-account-authority.ts`, exported from `domains/shortlet/src/index.ts`.
- Enforces ADR 0093 policy values as configurable options with compliant defaults, transaction atomicity via `BEGIN IMMEDIATE`, HMAC-bound code hashing and storage, purpose-bound challenges, 30-day absolute sessions, and envelope-gated email changes (ADR 0072).
- Zero credentials or secrets in audit or telemetry (ADR 0075).
- All 14 tests in `test/guest-account-authority.test.ts` pass, covering AC1–AC9, wrong-attempt lockouts, concurrent consumption, tenant isolation, and restart survival.
- `npm run check` and full `npm test` (Phase 1 concurrent and Phase 2 real browser, 165 passed, 0 failed, 1 skipped) passed cleanly on 5 October 2026.
