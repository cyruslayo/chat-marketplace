# PRD: Guest accounts (sign-in, account management, identity-assurance anchor)

Status: ready-for-agent
Requested: 2 Oct 2026
Decisions approved by the user: 2 Oct 2026

## Problem

A Guest has no account. The first `GET /` mints a random `guest-<uuid>` principal and an HttpOnly cookie (`issueGuestSession`, `apps/local-guest/src/guest-server.ts:6284`); only a salted hash of the cookie is stored (`guest_session_bindings`, `domains/shortlet/src/guest-interaction-store.ts:307`). Threads (`guest_threads.principal_id`), Booking Requests (`guest_booking_requests.primary_guest_id`) and contacts (`guest_contacts.guest_id`) are all keyed by that throwaway principal.

This was a deliberate pilot shortcut, not a decision:

- ADR 0085 moved Guest Identity Verification from booking to check-in, so the booking flow never needed a durable Guest.
- ADR 0086 gave Operators real authentication; nothing equivalent exists for Guests.
- Older ADRs assume an account that was never specified: ADR 0012 speaks of the "verified account holder", ADR 0084 of re-verification when "the Guest account identity" changes.

Consequences today:

- Guest sessions never expire and cannot be revoked or signed out (ADR 0070 expects logout and revocation to end streams).
- Clearing cookies or switching device loses every conversation, request and booking.
- The contact email collected at request time is never proven to belong to the Guest.
- `GuestIdentityVerificationResultSource` (`domains/shortlet/src/guest-verification.ts:29`) is keyed by `guestId`, which is the throwaway principal. A future verification result (ADR 0084: "an otherwise current verified Guest does not re-verify for every Booking Request") would have nothing stable to attach to.
- The follow-on effort `.scratch/guest-stays-and-favourites/` (stay history, reviews, owner messages, favourites) cannot work across devices without an account.

## Goal

A Guest can create an account and sign in on any device with an emailed one-time code, see and manage their account, and sign out (here or everywhere). Bookings made before signing in on that device follow the Guest into the account. The account is the stable anchor that future identity verification attaches to. Browsing and booking never require an account.

## User stories

Sign-in
1. As a Guest, I can enter my email and receive a one-time sign-in code, so I can prove the email is mine without a password.
2. As a Guest, I type the code on the page (no link to click), so sign-in works in any browser and without JavaScript.
3. As a Guest who mistypes, I see a clear error and can try again until the attempt limit; after that I must request a new code.
4. As a Guest, I am not told whether an email already has an account until I prove I own it.
5. As a Guest who has never signed in, signing in creates my account.

Continuity
6. As a Guest who chatted and booked on this device before signing in, my conversations, requests and bookings appear in my account once I sign in.
7. As a Guest signing in on a second device, I see everything from my first device.
8. As a Guest, I can still search, request and pay without an account (ADR 0085).
9. As a Guest who has just sent a request or confirmed a booking, I am offered "Keep this booking on all your devices" with my contact email pre-filled.

Account management
10. As a signed-in Guest, I can see my account: email, phone, identity status.
11. As a signed-in Guest, I can change my email (the new one is verified by code) and my phone number.
12. As a signed-in Guest, I can sign out of this device, or out of every device.
13. As a signed-in Guest, I can delete my account and download my data, under the retention rules settled in issue 01.

Identity readiness
14. As the platform, a Guest's identity-verification result attaches to the Guest Account, so a verified Guest is not re-verified for every booking while the result is fresh (ADR 0084).
15. As the platform, check-in eligibility can require that the Reservation belongs to an account, and fails closed when it does not (ADR 0085).

## The design

**Guest Account.** A durable record with a stable opaque `accountGuestId` (prefix to be settled in issue 02), a verified primary email, an optional phone, timestamps and a status (active, closed). The `accountGuestId` is the domain Guest identity going forward; it is never an interaction id (ADR 0070).

**Linked principals and scoped claims.** Existing session principals (`guest-<uuid>`) stay as interaction identities. Signing in from a browser links the current principal to the account in `guest_account_principals (principal_id, tenant_id, account_guest_id, linked_at)`. This device-possession path provides the permitted history of that principal. Proving a historical request email on a new device creates a separate resource-scoped claim for matching Booking Requests and their causally related offer, payment and booking records; it does not link the entire old principal or expose unrelated requests, conversations or Saved Stays. Claims require authoritative, unambiguous request-email evidence; the mutable current contact on a principal is not historical proof. **Existing booking, request and contract rows are never rewritten** (ADR 0004). A principal links to at most one account; a principal or claim already associated with another account is not moved.

**Guest identity resolution.** One resolver turns a browser session into `{ principalId, tenantId, accountGuestId?, assurance }`. Every Guest-scoped read and command goes through it. Authorization accepts a thread, request or booking only when its owner is the current principal, is linked to the live account session, or is explicitly within an account's scoped claim lineage; anything else, including a missing account on an account-only route, fails closed.

**Sign-in code and sessions.** Mirrors `SqliteOperatorSessionAuthority` (`domains/shortlet/src/operator-session-authority.ts`, ADR 0086):

- A code is random, stored only as a hash with tenant, normalized email, purpose, creation, expiry, attempt count and consumption time, under an opaque challenge id. It is consumed atomically on success; failed-attempt increments commit even when verification is refused.
- Wrong codes increment the attempt count; past the limit the code is dead.
- A successful sign-in issues a new opaque session secret (session fixation defence), stored only as a hash, with absolute expiry and optional revocation. The browser cookie carries no account, tenant or email claims.
- Sessions do not slide. Sign out revokes this session before clearing the cookie; sign out everywhere revokes every session of the account and ends attached streams (ADR 0070).
- Audit and telemetry carry only safe identifiers (`accountGuestId`, tenant, reason codes). Never the email, the code, the session secret or the cookie (ADR 0075).
- "Send me a code" responds the same way whether or not the email has an account.
- Code checking is limited to 25 per email per hour and 100 per client address per hour, configurable and shared across purposes (supplemental user approval, 4 Oct 2026; issue 01 Comments).

**Identity Assurance.** The account carries an assurance level: anonymous (no account), email-verified, phone-verified (later), government-ID-verified (future, ADR 0084). A verified outcome must have authoritative `verifiedAt` and `expiresAt`; no default freshness duration is approved, and ADR 0084's proposed 180-day period is not adopted. `GuestIdentityVerificationResultSource` resolves through the account, including Reservation-aware scoped claims, and checks expiry lazily. No provider, ID form, document upload or selfie is built (ADR 0085); only the port, a stored normalized outcome, and a local fake for tests.

**No booking gate.** Nothing in discovery, request, offer or payment checks for an account (ADR 0085 forbids identity checks or hidden bypasses there; an account gate would be the same thing by another name).

## Domain terms (added to `domains/shortlet/CONTEXT.md` in issue 02)

- **Guest Account**: the durable, email-verified record of a Guest across devices. _Avoid_: user, customer, profile, login.
- **Account Guest Id**: the opaque, stable Guest identity owned by a Guest Account.
- **Linked Principal**: an interaction principal joined to a Guest Account by a successful sign-in.
- **Sign-In Code**: the single-use, short-lived code that proves control of an email address.
- **Guest Account Session**: the server-owned binding between a browser cookie and a Guest Account.
- **Identity Assurance**: what has been proven about the person behind a Guest Account (email, phone, government ID), with its freshness. _Avoid_: KYC status, verified badge.

## ADR compliance (read these before any issue)

| ADR | Constraint | Where it bites |
| --- | --- | --- |
| 0004 | Backend owns authoritative state | accounts and links live server-side; committed booking rows are never rewritten to the account id |
| 0011 | Minimization, operator redaction, reusable assurance | operators never see account email or assurance evidence |
| 0012 | Verified account holder is the primary guest | the account is the "account holder"; it does not change Self-Booking rules |
| 0013 | Primary Guest is also the payer | email proof and account sign-in do not establish payer attribution |
| 0067 | Sensitive account changes use authenticated web surfaces | email changes, export and deletion stay on web |
| 0068 | Ordinary authentication is outside the agent protocol | account endpoints remain conventional platform-owned interfaces |
| 0070 | Interaction ids separate from domain ids; logout and revocation end streams | principal vs `accountGuestId`; sign out everywhere |
| 0072 | Consequential actions are platform commands | account changes go through command envelopes |
| 0075 | No bearer credentials or identity data in logs or interaction state | codes, emails, cookies never logged; hashes only |
| 0078 | WCAG 2.2 AA, 44px targets, 320px reflow, `en-NG`, WAT | sign-in, code and account pages |
| 0080 | Every critical workflow has a no-JS route | sign-in and account forms are plain forms |
| 0084 | Results reusable while fresh; re-verify when account identity changes | assurance keyed by account; email change is an identity change |
| 0085 | No identity check or bypass before booking; access fails closed | no account gate; check-in requires a claimed reservation |
| 0086 | One-time hashed token, opaque non-sliding session, fail closed, safe audit | pattern for the guest code and session; ADR 0093 records where Guests differ (email delivery of a code, no URL token) |
| 0093 | Guest Account authentication, session and recovery boundary | opaque account sessions, optional sign-in, linked-principal continuity and scoped email claims |
| 0094 | Identity Assurance is account-owned and explicitly expiring | Reservation-aware check-in resolution, no 180-day default, no provider integration or booking gate |

## Settled policy values

Settled by the user on 3 Oct 2026 in issue 01 (see its `## Answer` for reasons). Authentication ADR 0093 and assurance ADR 0094 cite them; code takes configurable policy options with these defaults.

- **Sign-in code:** 6 digits, 10-minute lifetime, 5 wrong attempts, one request per 60 s, max 5 per email per hour and 20 per client address per hour; a new code invalidates the earlier one.
- **Code checking:** at most 25 checks per email per hour and 100 per client address per hour; configurable and shared across code purposes (supplemental decision recorded in issue 01 Comments, 4 Oct 2026).
- **Guest Account Session:** 30 days absolute, non-sliding; a fresh code for email change, deletion and export.
- **Check-in:** requires a Reservation that belongs to a Guest Account.
- **Linking and recovery:** current-device sign-in links that principal's permitted history; a principal already linked to another account cannot be moved.
- **Claim by email:** a proven historical email claims matching Booking Requests and their related records only; it never grants the entire old principal's unrelated history. Legacy requests without authoritative, unambiguous email evidence are not claimable by current-contact inference.
- **Retention:** booking and finance records anonymised and kept 6 years; conversations, Saved Stays and contacts deleted; delete refused during a live payment, an upcoming or current stay, or an open deposit claim. **Provisional until legal review (NDPA 2023), required before issue 10.**
- **Assurance labels:** "Email confirmed", "Phone added", "ID not checked yet – we'll do this before check-in", "ID checked".

Supplemental decisions approved 4 Oct 2026: assurance expiry is explicit (`verifiedAt` and `expiresAt`) with no freshness default; email-code checking quotas are as stated above. These refinements are recorded in issue 01 Comments.

## Out of scope

Identity-provider integration (Smile ID), SMS codes, social login, passwords and passkeys, Operator authentication changes, account-level preferences or marketing consent, the stay history and favourites screens (effort `guest-stays-and-favourites`).

## Slicing

See `map.md`.

## Verification for the whole effort

- `npm run check` clean; `npm test` green (both phases).
- Walkthrough: an anonymous Guest books on device A, signs in, opens device B (new browser context), signs in with a fresh code and sees the same threads and booking; sign out everywhere ends device A's stream.
- Failure paths covered by tests: expired code, reused code, wrong code past the limit, revoked session, principal already linked to another account, cross-tenant lookup.
- Logs and audit grep: no email, code or cookie value appears.
- Captures at 320, 390, 768, 1280, light and dark, with no horizontal overflow and no target under 44px (issue 11).
