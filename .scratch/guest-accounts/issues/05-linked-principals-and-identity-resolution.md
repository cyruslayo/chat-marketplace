# Linked principals and Guest identity resolution

Status: claimed
Type: task
Blocked by: 04
Requested: 2 Oct 2026

## Why

Everything a Guest owns is keyed by a session principal: `guest_threads.principal_id`, `guest_booking_requests.primary_guest_id`, `guest_contacts.guest_id`. An account must see the work of every principal it has signed in from, without rewriting committed rows (ADR 0004, 0070). Every Guest-scoped read must also authorize through one place so it can fail closed.

## What to build

- Table `guest_account_principals (principal_id PRIMARY KEY, tenant_id, account_guest_id, linked_at)` owned by the authority from issue 04 or a small companion store in the same module.
  - `linkPrincipal({ principalId, tenantId, accountGuestId })` is called on successful sign-in. A principal already linked to a *different* account fails closed; re-linking to the same account is a no-op.
  - `linkedPrincipals(accountGuestId, tenantId)` returns the set.
- A resolver (e.g. `resolveGuestIdentity`) returning `{ principalId, tenantId, accountGuestId?, assurance }` for a browser session. `assurance` comes from issue 09 once it lands; until then it is `email-verified` when an account exists and `anonymous` otherwise, using the level names from issue 01.
- Union queries:
  - `SqliteGuestInteractionStore.findThreadsForPrincipal` gains an account-aware sibling (e.g. `findThreadsForPrincipals(principalIds, tenantId)`).
  - A query for Booking Requests by a set of `primary_guest_id`s (index `idx_guest_requests_principal` already exists).
  - `committedWork` (`apps/local-guest/src/guest-server.ts:1479`) uses the union when an account is present.
  - `SqliteGuestContactRepository.find` is consulted for the account first, then the session principal.
- Authorization: the thread, request, offer and booking ownership checks in `guest-server.ts` (`bindBrowserThread`, `findGuestThreadForOffer`, and the Primary Guest checks) accept the session principal or a linked principal of the session's account, and nothing else. A missing tenant or a missing owner fails closed (AGENTS anti-pattern 1).
- Claim-by-email (issue 01, supplemental decision 4 Oct 2026): proving a recorded request email grants a scoped claim to matching Booking Requests and their causally related records. It does not link the entire principal or expose unrelated history. Use authoritative, unambiguous request/checkout evidence; never infer historical request email from mutable current principal contact. Existing links/claims owned by another account are never moved.

## Acceptance criteria

- AC1: After a Guest on device A signs in, a second principal on device B that signs into the same account sees A's threads, requests and bookings. Failure path: a third principal not linked to the account sees none of them.
- AC2: Linking a principal that is already linked to another account fails and changes nothing.
- AC3: No row in `guest_booking_requests`, `booking_contracts`, `booking_reservations` or `guest_booking_snapshots` changes when principals are linked (snapshot the tables before and after).
- AC4: `committedWork` lists live work from every linked principal and only from them.
- AC5: Opening a thread or offer owned by an unlinked principal is refused even with a valid account session; a record with a missing tenant is refused.
- AC6: An anonymous session (no account) behaves exactly as today (existing tests stay green unchanged).
- AC7: After signing in with an email, a Booking Request made on another device with that contact email appears in the account. Failure path: a request with a different contact email does not appear, and a principal already linked to another account is not moved.

## Tests to add/update

New `test/guest-account-linking.test.ts`. Re-run the session tests that cover `resolveBrowserSession`, restart persistence (`test/guest-browser-restart.test.ts`; the earlier `HANDOFF-guest-restart-persistence.md` reference pointed at a file that does not exist) and committed work (`test/guest-new-conversation.test.ts`, issue 13a of `guest-chat-first-ux`).

## ADR compliance

0004, 0070, 0075, 0093.

## Comments

- 10 Oct 2026, ADR map (0004, 0070, 0075, 0093, 0094; 0085 and 0086 read as context): 0004, linking and claims never rewrite `guest_booking_requests`, `booking_contracts`, `booking_reservations` or `guest_booking_snapshots` (AC3 snapshots them). 0070, the account identity holds principal ids as interaction identities, separate from `accountGuestId`. 0075, nothing is logged, and no audit entries are emitted. 0093, one principal links to at most one account, claims are per request, conflicts fail closed. 0094, missing or conflicting ownership grants no account authority.
- 10 Oct 2026, personal-data classification: the new tables (`guest_account_principals`, `guest_account_request_claims`, `guest_booking_request_contacts`) are exported in the daily export, following the existing precedent. Only bearer-credential tables (`CREDENTIAL_TABLES`) are excluded. Like `guest_accounts` and `guest_contacts`, they hold personal data (email and principal identifiers) and are flagged for the DPIA (see issue 12a). This is a human decision to confirm.

## Answer

- `guest_account_principals` (Linked Principals) and `guest_account_request_claims` (scoped claims) are in `domains/shortlet/src/guest-account-links.ts`, with `SqliteGuestAccountLinks`. They are applied by migration 3 in `apps/cloudflare/src/schema.ts`.
- `GuestIdentityResolver`, `anonymousGuestIdentity`, `authorizesPrincipalOwner`, `authorizesBookingRequest` and `resolveGuestContact` are in `domains/shortlet/src/guest-identity.ts`.
- The contact snapshot is `guest_booking_request_contacts`, inserted once when a request is first saved (`SqliteGuestInteractionStore.saveBookingRequest`), and never rewritten. Decision: this is a sibling insert-only table, not an `ALTER TABLE ... ADD COLUMN`. An `ALTER` migration fails with a duplicate column on Node files that the store constructor already touched, and `export-node-sqlite --migrate` runs on exactly those files (runbook R5). The table is created with `IF NOT EXISTS` in both the store constructor and migration 3. The reason is recorded in the code comment on `GUEST_REQUEST_CONTACT_SCHEMA`.
- `committedWork(principal, identity?)` lists work from the identity's linked principals only. Without an account it behaves as before.
- Test coverage: `test/guest-account-linking.test.ts` (14 tests).
- Still for issue 06: the account session cookie, and wiring `resolveBrowserSession` and the Primary Guest checks to a resolved account identity.
