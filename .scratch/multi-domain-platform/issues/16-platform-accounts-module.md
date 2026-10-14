# Platform Accounts: move guest accounts and sign-in by emailed code out of shortlet

Status: ready-for-agent
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
