# ADR draft: multi-domain Cloudflare hosting (amends 0095) and platform accounts (amends 0093)

Status: ready-for-human
Type: grilling
Blocked by: 01
Requested: 14 Oct 2026
Unlocks: 16, 17
Lane: A: Decisions
PRD: `../PRD.md`

## Why

Today one `ShortletPilot` Durable Object per tenant holds everything (`apps/cloudflare/src/worker.ts`). A conversation that spans two domains, and one sign-in for both, need a platform home.

## What to build

1. Draft an ADR amending 0095: one Worker; a platform DO for accounts, conversations and tasks; one DO class per domain owning its transactions; routing by domain; R2 for receipts and product images.
2. Draft (or include) the amendment to 0093/0094: accounts and sign-in by emailed code become platform-owned; identity assurance (Smile ID, ADR 0084/0094) stays a shortlet requirement.
3. List data-migration consequences for existing pilot data (ADR 0096 export, `apps/cloudflare/src/do-export.ts`).

## Out of scope

- Implementation (slices 16, 17, 24).

## Acceptance criteria

- AC1: The ADR(s) exist and state which DO owns accounts, conversations and each domain's transactions.
- AC2: Pilot data migration consequences are listed.
- AC3: The owner has accepted, recorded in `## Comments`.

## Tests

None (document).

## ADR compliance

| ADR | Why it matters here |
| --- | --- |
| `docs/adr/0095-host-the-pilot-on-cloudflare.md` | Being amended. |
| `docs/adr/0093-establish-guest-accounts-and-sign-in-by-emailed-code.md` | Accounts move to the platform. |
| `docs/adr/0094-anchor-identity-assurance-to-the-guest-account.md` | Assurance stays anchored to the account. |
| `docs/adr/0075-secure-and-minimize-agent-interaction-data.md` | Data minimization across DOs. |

Before starting, also list `docs/adr/` and read any other ADR that touches the files you change (AGENTS.md implementation protocol).

## Definition of Done

Decision slice. DoD items 3 and 5 apply: every listed ADR is read and cited, and nothing is decided that the owner has not confirmed. No production code changes.

## Comments
