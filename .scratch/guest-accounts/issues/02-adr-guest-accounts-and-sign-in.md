# ADR 0093: Guest accounts and sign-in by emailed one-time code

Status: resolved
Type: task
Blocked by: 01
Requested: 2 Oct 2026

## Why

There is no ADR for Guest authentication. ADR 0086 is Operator-only and explicitly says tokens are "never placed in URLs or delivered by email". Guests need email delivery, so the difference must be decided and recorded, not slipped into code.

## What to build

- `docs/adr/0093-establish-guest-accounts-and-sign-in-by-emailed-code.md`, in the house ADR style (see 0085 and 0086), recording:
  - the Guest Account, Account Guest Id and Linked Principal model from `PRD.md` "The design"
  - an emailed **code typed into the page**, never a link or URL token, with the reason (history, referrer and mail-scanner exposure; no-JS parity, ADR 0080)
  - the settled values from issue 01 (code, lifetime, wrong attempts, resend/send throttle, session lifetime) and its supplemental 4 Oct code-checking quotas
  - non-sliding sessions, new secret on sign-in, sign out and sign out everywhere (ADR 0070)
  - enumeration-safe responses; safe-identifier audit only (ADR 0075)
  - no account gate on discovery, request, offer or payment (ADR 0085)
  - committed booking rows are never rewritten; device-possession links provide permitted principal history, while lost-device email recovery grants matching request-scoped claims rather than an entire old principal (ADR 0004, 0070)
  - a replaceable authentication boundary, as ADR 0086 says for Operators
- `domains/shortlet/CONTEXT.md`: add the six terms from `PRD.md` "Domain terms", each with an _Avoid_ line. Make sure "account holder" in the Primary Guest _Avoid_ list still reads correctly (the Primary Guest is a booking role; the Guest Account is the person's durable record).
- `packages/platform-core/CONTEXT.md`: note that a browser session may resolve to a Guest Account (interaction side only).

## Acceptance criteria

- AC1: ADR 0093 exists, follows the numbering after the accepted Extended Stays ADR 0092, and cites 0004, 0070, 0075, 0080, 0085 and 0086.
- AC2: Every policy number in the ADR traces to issue 01's `## Answer` or its dated supplemental decision in `## Comments`.
- AC3: `CONTEXT.md` defines Guest Account, Account Guest Id, Linked Principal, Sign-In Code, Guest Account Session and Identity Assurance, with no conflict with existing terms (grep for each new term and for "account").
- AC4: The ADR states, in one sentence each, that booking never requires an account and that codes never appear in URLs, logs or audit.

## Tests to add/update

None (documentation). The agent checks AC3 with a grep listed in `## Answer`.

## ADR compliance

0004, 0011, 0012, 0013, 0067, 0068, 0070, 0072, 0075, 0078, 0080, 0084, 0085, 0086.

## Comments

- 4 Oct 2026: ADR 0092 is already occupied by the accepted Extended Stays decision. This issue's authentication ADR is renumbered to 0093; the identity-assurance ADR becomes 0094. Account-specific issue references and the map are updated by meaning; Extended Stays references to 0092 remain unchanged.
- 4 Oct 2026 ADR map: 0004 — committed rows remain authoritative and unrewritten (account identity/linking); 0011 — minimize assurance and redact operator view (account/assurance boundary); 0012 — account does not alter Primary Guest role (identity model); 0013 — email proof is not payer attribution (sign-in/payment boundary); 0067 — sensitive account operations stay on authenticated web surfaces (channels); 0068 — ordinary auth remains outside agent protocol (HTTP boundary); 0070 — separate identities and revoke attached authority (session model); 0072 — account changes use platform commands (mutation boundary); 0075 — no secrets or restricted identity in logs/state (code/session handling); 0078 — accessible localized forms/deadlines (future UI acceptance); 0080 — deterministic no-JS recovery (code entry); 0084 — assurance expiry remains explicit/no unapproved freshness (future assurance); 0085 — no account gate before booking (all sign-in paths); 0086 — Operator policy is only a pattern, not Guest code/session policy.

## Answer

Implemented in commit `aa74d9d`.

- **AC1:** Added `docs/adr/0093-establish-guest-accounts-and-sign-in-by-emailed-code.md`; ADR 0092 remains the accepted Extended Stays decision. ADR 0093 cites 0004, 0070, 0075, 0080, 0085 and 0086 and maps all intersecting decisions.
- **AC2:** Code/session values trace to issue 01 Answer. The 25/email/hour and 100/address/hour code-checking quotas trace to the dated 4 Oct supplemental decision in issue 01 Comments.
- **AC3:** Grep confirmed all six terms are defined in `domains/shortlet/CONTEXT.md`, each with an `_Avoid_` line. The Primary Guest entry expressly distinguishes a booking role from the Guest Account; `packages/platform-core/CONTEXT.md` limits account resolution to server-owned interaction context.
- **AC4:** ADR 0093 states that discovery, Request to Book, offer acceptance and payment never require sign-in; it also states in one sentence that codes and related credentials never appear in URLs, logs, audit or general interaction state.
- Updated the PRD, issue briefs and map for ADR renumbering, scoped request claims, explicit assurance expiry and the approved verification quotas.
- **Checks:** documentation-only issue; ran the six-term/context grep, policy/ADR grep and `git diff --check` (all passed). No tests were required by this issue.
