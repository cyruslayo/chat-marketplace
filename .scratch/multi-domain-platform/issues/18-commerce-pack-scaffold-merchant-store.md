# Commerce pack scaffold: registration, migrations, Merchant and Store with verification gating

Status: ready-for-agent
Type: task
Blocked by: 03, 12
Requested: 14 Oct 2026
Unlocks: 19
Lane: D: Commerce
PRD: `../PRD.md`

## Why

Start the second domain using only the `DomainPack` interface; if it needs to bypass it, fix the interface instead.

## What to build

1. Create `domains/commerce/src/` with `index.ts` exporting `createCommercePack(deps)` only.
2. Migrations on `SqlDatabase` for Merchant and Store (status: pending/verified/suspended; store active/suspended), following instastore `supabase/migrations/0007_multi_store_foundation.sql` for store fields.
3. Only stores of verified merchants are visible to consumers.
4. Use `domains/commerce/CONTEXT.md` vocabulary (Merchant, Store, Consumer).

## Out of scope

- Products (19), orders (21), UI.

## Acceptance criteria

- AC1: The commerce pack registers through the same registry as shortlet with no special case.
- AC2: A store whose merchant is not verified is never returned to consumers.
- AC3: A suspended store is never returned to consumers.
- AC4: The boundary test covers `domains/commerce`.

## Tests

`test/commerce-merchant-store.test.ts`, one test per AC.

## ADR compliance

| ADR | Why it matters here |
| --- | --- |
| `docs/adr/0001-merchants-are-sellers-of-record.md` | Merchant identity. |
| `docs/adr/0003-build-an-extensible-concierge-platform.md` | Second pack. |
| ADR from slice 03 | Commerce decisions. |

Before starting, also list `docs/adr/` and read any other ADR that touches the files you change (AGENTS.md implementation protocol).

## Definition of Done

Apply every item of the Definition of Done in `docs/agents/issue-tracker.md`. Shortlet behaviour must not change: the existing tests and the guest UI walkthrough/capture checks are the safety net.

## Comments
