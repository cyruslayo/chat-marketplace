# Platform Accounts: move guest accounts and sign-in by emailed code out of shortlet

Status: resolved
Type: task
Blocked by: 05, 10
Requested: 14 Oct 2026
Unlocks: 17
Lane: C: Platform services
PRD: `../PRD.md`

## Why

One sign-in must serve both verticals (slice 05).

## What to build

Move `domains/shortlet/src/guest-account-authority.ts`, `guest-account-contacts.ts`, `guest-account-links.ts` into a platform `Accounts` module with a small interface. Identity assurance (`guest-identity-assurance.ts`) stays in shortlet and references the platform account id. Keep the "Guest" vocabulary inside shortlet; the platform term follows slice 05.

## Out of scope

- DO placement (17).

## Acceptance criteria

- AC1: Shortlet code has no account-session or emailed-code logic; it uses Accounts.
- AC2: Sign-in, linking and existing guest account flows pass unchanged.
- AC3: Identity assurance still anchors to the account (ADR 0094).

## Tests

Move existing account tests' subjects; reuse `test/helpers/guest-account-*.ts`.

## ADR compliance

| ADR | Why it matters here |
| --- | --- |
| `docs/adr/0093-establish-guest-accounts-and-sign-in-by-emailed-code.md` | Sign-in method. |
| `docs/adr/0094-anchor-identity-assurance-to-the-guest-account.md` | Anchor. |

Before starting, also list `docs/adr/` and read any other ADR that touches the files you change (AGENTS.md implementation protocol).

## Definition of Done

Apply every item of the Definition of Done in `docs/agents/issue-tracker.md`. Shortlet behaviour must not change: the existing tests and the guest UI walkthrough/capture checks are the safety net.

## Comments

- **ADR compliance (DoD 3).** ADR 0093 (amended by ADR 0101): the authority, sessions, emailed-code challenges and the linked principals/scoped claims moved to `packages/platform-core/src/accounts/`; the code, session and audit rules are unchanged (the moved files are byte-identical apart from import paths). ADR 0094: identity assurance stays in `domains/shortlet/src/guest-identity-assurance.ts`, keyed by `(tenantId, accountGuestId)`, and resolves through the platform links (`AccountBackedGuestIdentityVerificationResultSource`). ADR 0099 rule 2: the platform owns Accounts; the pack consumes it. ADR 0004: no committed booking row is rewritten by linking or claims.
- **Decision — the contact store moves too.** `guest-account-contacts.ts` reads the `guest_contacts` row and the `guest_accounts` email, so `guest-contact.ts` (the contact store, `normalizeContactEmail`, `normalizeNigerianPhoneNumber`) moved with it; otherwise the platform module would import domain code. ADR 0101 already places `guest_contacts` in the platform object.
- **Vocabulary.** The "Guest" identifiers (`GuestAccount`, `SqliteGuestAccountAuthority`, …) are kept to preserve every existing caller and test (AC2); the platform module is the new home, and the façade `Accounts`/`createPlatformAccounts` carries the neutral name. Renaming the types is left to a later slice.
- **Known coupling for slice 17.** `guest-identity-assurance.ts` still declares a SQL `FOREIGN KEY … REFERENCES guest_accounts` and an `AFTER UPDATE OF email_normalized ON guest_accounts` trigger. In one SQLite file (Node/dev) these work; moving accounts into the platform Durable Object (slice 17) must replace them with an explicit account-existence check and an email-change invalidation call.

## Answer

`packages/platform-core/src/accounts/` holds `contact.ts`, `authority.ts`, `links.ts`, `account-contacts.ts`, plus `accounts.ts` (`Accounts` + `createPlatformAccounts`) and `index.ts`. `domains/shortlet/src/guest-{contact,account-authority,account-links,account-contacts}.ts` are deleted; shortlet's barrel re-exports the four platform modules so existing importers are unaffected, and its internal importers (`guest-identity`, `guest-identity-assurance`, `guest-check-in-eligibility`, `guest-interaction-store`, `booking-request`, `bank-transfer`, `card-payment`) import the platform paths. `GuestAccountRuntime` composes through `createPlatformAccounts`.

Tests: `test/platform-accounts.test.ts` (AC1 shortlet has no account-session or emailed-code logic; AC2 sign-in and linking work through the platform module and a forged or conflicting link fails closed; AC3 assurance is keyed by the Account Guest Id and resolves through the linked principal). The account sign-in, linking, authority and identity-assurance suites (229 tests) pass unchanged.

Test evidence: `npm run check` clean; `npm test -- --browser-only` 0 failures; `npm test -- --non-browser` 1769/1773 with the four failures that pre-date this slice on the working baseline (`16 AC1 (fixture)` export fixture, and the three `redact-platform-ids-generators` cases), none in the account, linking, assurance or contact suites.
