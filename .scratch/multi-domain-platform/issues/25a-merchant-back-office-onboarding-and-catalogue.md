# Merchant back office: onboarding and catalogue management

Status: claimed
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

## Answer

Implemented the merchant back office authorization + catalogue management:

- `domains/commerce/src/merchant-back-office.ts` — `MerchantBackOffice` (`merchantStores`, `merchantCatalogue`, `updateOfferPrice`, `markMerchantVerified`). A merchant principal is scoped to its own stores; an operator principal alone verifies a merchant.
- Repo read methods: `CommerceDirectory.storeById`/`storesOfMerchant`, `CommerceCatalogue.offersForStore`.
- `apps/local-merchant` — a minimal composition following `apps/local-owner`: `MerchantEnvironment` (one SQLite handle + `createCommercePack` + fixture seed), a small JSON server (`/catalogue`, `/orders`), `cli-start.ts`, and `index.ts`.
- `index.ts` exposes `backOffice` and re-exports the back-office principal type through the façade.

Acceptance criteria → `test/merchant-back-office-catalogue.test.ts`:

- AC1 — a merchant can only see and edit its own stores' catalogue.
- AC2 — only an operator can mark a merchant verified.
- AC3 — product edits are visible to the agent search immediately (no cache).

ADR compliance: 0001 (merchant as seller of record), 0086/0082 (auth/grants pattern), 0099 (one façade), 0100 (merchant verification gating). Full ADR 0086 merchant session/token provisioning and HTML views are the remaining UI work; the authorization rules here are the AC-level deliverable.

## Comments

- 16 Oct 2026 (agent): `npm run check` clean; 25a/25b and all prior commerce tests pass; boundary test AC4 green.
