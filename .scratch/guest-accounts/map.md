# Map: guest accounts

PRD: `PRD.md` · Follow-on effort: `../guest-stays-and-favourites/` (its issues 03, 04 and 11 are blocked by 05 and 06 here)

The frontier is the first issue, in phase order, that is open, unblocked and unclaimed. Each issue ends with `npm run check` and `npm test` green, and a commit on the effort branch.

Issue numbers are stable. Work in the **phase order** below, not by number.

### Phase 1: first slice, "log in and see my stays" (with stays 03 and 04)

| Order | # | Issue | Type | Blocked by |
| --- | --- | --- | --- | --- |
| – | 01 | Settle the account policy values | grilling | resolved 3 Oct 2026 |
| 1 | 02 | ADR 0093: Guest accounts and sign-in by emailed one-time code | task | 01 |
| 2 | 03 | ADR 0094: Anchor identity assurance to the Guest Account | task | 02 |
| 3 | 04 | Guest account authority: codes, accounts, sessions | task | 02 (resolved 5 Oct 2026) |
| 4 | 05 | Linked principals and Guest identity resolution (includes scoped claim by email) | task | 04 |
| 5 | 06 | Guest server: sign-in, sign-out and account session cookie | task | 05 |
| 6 | 09 | Identity-assurance port on the Guest Account | task | 03, 05 |
| 7 | 07 | Account page: contact details, sign out everywhere, identity status | task | 06, 09 |
| 6 | → | `../guest-stays-and-favourites/` issues 03 and 04 (My stays) | task | 05, 06 |

The slice is done when a Guest can sign in with a code on any device and see their upcoming and past stays. Each UI issue in it ends with its own captures (`AGENTS.md`).

### Phase 2: complete the account

| Order | # | Issue | Type | Blocked by |
| --- | --- | --- | --- | --- |
| 8 | 08 | Offer sign-in after a request and on confirmation | task | 06 |
| 9 | 10 | Delete account and download data | task | 01, 07, legal sign-off on issue 01 answer 6 |
| 10 | 11 | Walkthrough stages and captures for account screens | task | 07, 08, 10 |

### Phase 3: needs legal review first

| Order | # | Issue | Type | Blocked by |
| --- | --- | --- | --- | --- |
Issue 10's legal review progresses alongside implementation but it must be resolved before account completion and final issue-11 captures.

## Kickoff prompt for a new session

> Implement phase 1 of the guest accounts effort (the "log in and see my stays" slice), then stays issues 03 and 04 from `.scratch/guest-stays-and-favourites/`. Read `.scratch/guest-accounts/PRD.md`, then `map.md`, and follow the implementation protocol in `AGENTS.md` (ADR table, one failing test per acceptance criterion, Definition of Done in `docs/agents/issue-tracker.md`). Work on branch `feat/guest-accounts` from an up-to-date `main`. For each issue: claim it, read the ADRs it lists, write the failing tests, implement, run `npm run check` and the full `npm test` (browser phase in the background, about 12 minutes), commit, then write the `## Answer` and a context pointer here.
> - Don't invent policy numbers, copy or retention periods; they come from issue 01 or from me.
> - Never log an email, code, session secret or cookie (ADR 0075).
> - Booking must never require an account (ADR 0085).

## Context pointers

(Append one line per resolved issue: what landed and where.)

- 01: policy values settled with the user on 3 Oct 2026; see the issue's `## Answer` and `PRD.md` "Settled policy values". Retention (answer 6) is provisional until legal review.
- 02: **resolved** in `aa74d9d`; authentication policy and identity model recorded in ADR 0093. ADR 0092 remains the accepted Extended Stays decision. Assurance ADR is 0094; account recovery uses request-scoped email claims and explicit assurance expiry. See issue 02 Answer.
- 03: **resolved** in `29a546a`; ADR 0094 anchors normalized assurance to the Guest Account, requires explicit outcome expiry, and documents the scoped Reservation claim path without changing ADR 0085. See issue 03 Answer.
- 04: **resolved**; implemented `SqliteGuestAccountAuthority` in `domains/shortlet/src/guest-account-authority.ts`. Enforced one-time codes, account creation, 30-day absolute sessions, quotas, envelope-based email change, audit redacting, and persistence across restarts. Full suite and check green on 5 October 2026.
- Integration: `a86ceb8` adds durable, authenticated email-change command retries and closes review coverage gaps; `5772c8a` fixes RB8's premature recovery-focus check. Full serial suite on `5772c8a` passed 1,247 non-browser and 165 browser tests, zero failures, one expected skip; typecheck and whitespace checks passed. See issue 04's integration DoD table. Issues 05 onward remain separate delivery work.
- 05: **resolved** on PR #100 (branch `ga-05-linked-principals`): Linked Principals and scoped request claims (`domains/shortlet/src/guest-account-links.ts`), the identity resolver and authorization decisions (`domains/shortlet/src/guest-identity.ts`), the immutable contact snapshot table, and migration 3. Route-level account wiring (the session cookie, `bindBrowserThread`, Primary Guest checks) is issue 06. See issue 05 `## Answer` and `## Comments`.
