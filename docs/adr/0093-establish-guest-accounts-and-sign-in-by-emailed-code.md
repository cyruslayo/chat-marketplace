# Establish Guest Accounts and sign-in by emailed code

## Context

Guest browser sessions currently identify a Guest through a temporary interaction principal. Clearing a cookie or changing devices loses continuity, while the platform needs a stable identity anchor for account management and future check-in assurance. Guest authentication is distinct from Operator authentication in ADR 0086: Guests must receive a one-time code by email, while Operator tokens are intentionally not delivered by email.

The Guest Account is optional. Booking authority remains independent of account authentication, and committed booking records keep the identity under which they were created.

## Decision

### Guest Account identity

- A **Guest Account** is a durable, tenant-scoped record with an opaque, stable **Account Guest Id**, verified primary email, optional phone, timestamps, revision and active/closed status. Account Guest Ids use the `gacct-` prefix followed by 128 bits of cryptographically random base64url data; the identifier encodes no email, tenant or permission.
- The Account Guest Id is the durable domain Guest identity for new account-authenticated actions. It is not an interaction, browser-session, thread or booking identifier (ADR 0070).
- An anonymous browser **principal** remains an interaction identity. Successful sign-in may link the current principal to one Guest Account as a **Linked Principal**. A principal may link to at most one account; a conflicting link fails closed and does not move existing ownership.
- A device principal linked during successful sign-in provides continuity for its permitted history. Recovery on a new device by proving a historical request email creates resource-scoped claims for matching Booking Requests and their causally related records; it does not link or disclose every record owned by an old principal. Historical contact evidence must be authoritative and unambiguous. The current mutable contact on a principal is not proof of a request's historical email.
- Account identity resolution is server-owned and tenant-scoped. Client-supplied principal, account or resource identifiers do not establish ownership. Every protected read and command checks the authenticated account and its direct, linked-principal or explicitly scoped resource authority.
- Existing request, offer, contract, Reservation and financial rows are never rewritten when a principal is linked or a scoped claim is granted. Reads may combine records only through authorized account ownership, Linked Principals and explicit claims (ADR 0004).
- A Guest Account is not a booking party or payer role. Self-Booking and Primary Guest requirements remain governed by ADRs 0012 and 0013.

### Email Sign-In Code

- A Guest requests a **Sign-In Code** for a normalized email address. The server sends a one-time code by email, and the Guest types it into a conventional page. Codes are never delivered as a sign-in link or placed in a URL; typed entry avoids history, referrer and mail-scanner exposure and supports no-JavaScript parity (ADR 0080).
- Code policy is six decimal digits, a ten-minute lifetime, five wrong attempts, a 60-second resend interval, at most five requests per email per hour and 20 requests per client address per hour. A permitted new request invalidates an earlier unused code for the same email and purpose.
- Code checking is additionally limited to 25 checks per email per hour and 100 per client address per hour. These supplemental limits were approved by the user on 4 Oct 2026 and recorded in issue 01 Comments; the authority exposes them as configuration. Purpose-specific endpoints and tenant contexts share the same email and address budgets so switching purpose or tenant cannot multiply the allowance.
- Codes are stored as cryptographic hashes bound to tenant, normalized email and purpose, with an opaque challenge identifier; raw codes are available only to the immediate delivery call. Successful verification consumes the challenge atomically. Wrong-attempt increments persist even when verification is refused.
- Sign-in request responses do not reveal whether an account exists. A successful code proof finds or creates an active account and issues a fresh opaque **Guest Account Session** secret. Only its hash is stored; the cookie carries no account, email, tenant or permission claims.
- Sign-in codes are single-purpose. Email-change, export and deletion proofs are action-bound and cannot be substituted for sign-in or another sensitive action.

### Guest Account Sessions

- A Guest Account Session has an absolute 30-day lifetime, does not slide, and is stored server-side with tenant, account, creation, expiry and revocation state. The 30-day value is the Guest policy in issue 01 and does not inherit the Operator's 12-hour session duration.
- Sign-in rotates the browser's interaction-session binding so the pre-sign-in cookie cannot authorize account history. The account cookie is opaque, HttpOnly and SameSite=Lax; Secure is enabled for secure deployments.
- Signing out revokes the current account session before clearing its cookie and rotates the browser to a fresh unlinked anonymous interaction principal. Signing out everywhere revokes all account sessions and their attached interaction authority. Authentication invalidation terminates attached streams and confirmation authority (ADR 0070), without undoing already committed domain actions.
- Expired, revoked, closed-account, malformed, cross-tenant or otherwise unresolvable credentials fail closed. A linked anonymous cookie by itself cannot regain account history after the account session is absent, expired or revoked.

### Sensitive data and audit

- Account state and authorization are authoritative in platform services. Interaction projections contain only explicitly approved, redacted presentation facts (ADRs 0004 and 0075).
- Codes, code hashes, session secrets, cookies, email addresses and restricted identity material never appear in URLs, ordinary logs, audit records or general interaction state. Audit records contain only safe identifiers, timestamps, command/type and reason/status codes; secret-bearing payloads are excluded.
- Authentication uses replaceable platform-owned application boundaries. Replacing email delivery or the session mechanism must not alter booking rules, domain ownership or account authorization semantics (ADR 0086).

### No booking gate

Discovery, Request to Book, offer acceptance and payment never require a Guest Account or sign-in; account authentication does not add a hidden booking eligibility check (ADR 0085).

## Consequences

- Guests can recover permitted history across devices without passwords, and anonymous booking remains available.
- Linking does not mutate committed booking ownership. Account reads and actions must consistently apply Linked Principal and scoped-claim authorization.
- Proving one historical request email deliberately does not recover unrelated records, conversations or Saved Stays under an old principal.
- Code-delivery availability is an authentication capability; its failure must not disable anonymous discovery or booking.
- Future Identity Assurance attaches to the Account Guest Id under ADR 0094, with explicit outcome expiry and the check-in boundary established by ADR 0085.

## ADR mapping

| ADR | Constraint applied here |
| --- | --- |
| 0004 | Backend owns authoritative state; linking and claims do not rewrite committed rows. |
| 0011 | Identity assurance is minimized and operators do not receive raw evidence. |
| 0012 | Account identity does not change the Primary Guest's self-booking role. |
| 0013 | Account/email proof does not establish payer attribution. |
| 0067 | Sensitive account changes use authenticated web surfaces. |
| 0068 | Conventional authentication is outside the agent-runtime protocol boundary. |
| 0070 | Interaction and domain identities remain distinct; authentication invalidation revokes attached authority. |
| 0072 | Consequential account changes use authenticated, authorized platform commands. |
| 0075 | Credentials and restricted identity data are excluded from logs, audit and interaction state. |
| 0078 | Guest forms follow accessible, responsive, English (Nigeria) and WAT presentation requirements. |
| 0080 | Sign-in and recovery have deterministic conventional/no-JavaScript routes. |
| 0084 | Identity-assurance reuse and identity-change invalidation are account-scoped; its proposed 180-day value is not adopted here. |
| 0085 | Identity assurance is enforced at check-in, not during booking; this ADR adds no provider or booking gate. |
| 0086 | Operator authentication is a pattern only; Guest code delivery and session policies are separately specified here. |

## Policy sources

The six-digit code, ten-minute lifetime, five wrong attempts, resend interval and send quotas; 30-day absolute session; email-change/export/deletion step-up; and check-in account requirement trace to issue 01 Answer (3 Oct 2026). The additional code-checking quotas trace to the user's supplemental approval recorded in issue 01 Comments (4 Oct 2026). No identity-assurance freshness duration is set by this ADR.
