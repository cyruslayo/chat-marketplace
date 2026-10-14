# Merchant back office: onboarding and catalogue management

Status: ready-for-agent
Type: task
Blocked by: 19
Requested: 14 Oct 2026
Unlocks: 25b
Lane: D: Commerce
PRD: `../PRD.md`

## Why

Merchants need to manage stores and products; instastore's `/admin` is the UX reference.

## What to build

Create `apps/local-merchant` following `apps/local-owner` (sessions, views, CLI provisioning). Operator-assisted onboarding (per instastore `docs/MERCHANT_ONBOARDING.md`), verification status set by an operator, product/offer/variant CRUD, image upload. Merchant authentication follows ADR 0086's pattern unless slice 05 says otherwise.

## Out of scope

- Orders and delivery (25b).

## Acceptance criteria

- AC1: A merchant can only see and edit their own stores' catalogue.
- AC2: Only an operator can mark a merchant verified.
- AC3: Product edits are visible to the agent search immediately.

## Tests

One test per AC.

## ADR compliance

| ADR | Why it matters here |
| --- | --- |
| `docs/adr/0086-establish-pilot-operator-authentication-and-session-authority.md` | Auth pattern. |
| `docs/adr/0082-establish-explicit-operator-representative-grants.md` | Grants pattern. |

Before starting, also list `docs/adr/` and read any other ADR that touches the files you change (AGENTS.md implementation protocol).

## Definition of Done

Apply every item of the Definition of Done in `docs/agents/issue-tracker.md`. Shortlet behaviour must not change: the existing tests and the guest UI walkthrough/capture checks are the safety net.

## Comments
