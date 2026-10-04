# Guest account authority: codes, accounts, sessions

Status: ready-for-agent
Type: task
Blocked by: 02
Requested: 2 Oct 2026

## Why

The domain needs one authority that issues and checks Sign-In Codes, finds or creates Guest Accounts, and issues, resolves and revokes Guest Account Sessions. The Operator equivalent already exists and is the pattern to follow.

## What to build

- `domains/shortlet/src/guest-account-authority.ts`, exported from `domains/shortlet/src/index.ts`. Model it on `SqliteOperatorSessionAuthority` (`domains/shortlet/src/operator-session-authority.ts`): `BEGIN IMMEDIATE` transactions, `#now()` clock guard, `#emit` to optional audit and telemetry sinks that can never block auth, hashed secrets.
   - Policy values from ADR 0093 are constructor options with the ADR values as defaults (AGENTS anti-pattern 3), not literals in logic. Include purpose-bound `delete_account` and `export_data` proofs and the supplemental checking quotas.
   - Tables: `guest_accounts` (account_guest_id, tenant_id, email, phone, status, created_at, updated_at, revision), `guest_sign_in_codes` (opaque challenge id, code_hash, tenant_id, email, purpose `sign_in`|`change_email`|`delete_account`|`export_data`, bound account/session/revision where required, created_at, expires_at, attempts, consumed_at), `guest_account_sessions` (session_id, session_secret_hash, account_guest_id, tenant_id, created_at, expires_at, revoked_at). The low-entropy code hash is not a global primary key.
  - `requestCode({ tenantId, email, purpose })`: normalizes with `normalizeContactEmail` (`domains/shortlet/src/guest-contact.ts`), stores only the hash, returns the plain code to the caller once (for the notifier). Same outcome shape whether or not the account exists.
  - `verifyCode({ tenantId, email, code })`: wrong code increments attempts; expired, consumed or over-limit fails. On success, consumes atomically, finds or creates the account, issues a new session. Returns `{ sessionId, sessionSecret, accountGuestId, expiresAt }`.
  - `resolveSession(sessionId, secret)`: returns the principal or a rejection (`missing`, `expired`, `revoked`), as `OperatorSessionRejection` does.
  - `revokeSession`, `revokeAllSessions(accountGuestId)`.
  - `changeEmail`: requires a `change_email` code sent to the *new* address and a live session; bumps `revision`.
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
