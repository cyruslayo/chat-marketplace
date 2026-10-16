# Commerce pack scaffold: registration, migrations, Merchant and Store with verification gating

Status: claimed
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

## Answer

Implemented the commerce domain scaffold at `domains/commerce/src/` with a single façade, `createCommercePack(deps)`:

- `merchant.ts` / `store.ts` — Merchant (`pending/verified/suspended`) and Store (`active/suspended`) types and fail-closed parsers; the Store slug regex `^[a-z0-9]+(-[a-z0-9]+)*$` is ported from instastore `0007` and enforced in the parse layer (SQLite has no Postgres `~`).
- `commerce-directory.ts` — normalized `merchants`/`stores` tables (`MERCHANT_SCHEMA`, `STORE_SCHEMA`), ordered `COMMERCE_SCHEMA_MIGRATIONS`, and `CommerceDirectory` (`createMerchant`, `createStore`, `consumerStores`). `consumerStores()` JOINs to merchants and returns only `verified` merchants' `active` stores.
- `index.ts` — `createCommercePack(deps)` only. Returns an `id: "commerce"` pack that is structurally an `AssistantDomainPack` (registers through `AssistantPackRegistry` with no special case) plus `migrations` and the `directory`.

Acceptance criteria → tests in `test/commerce-merchant-store.test.ts`:

- AC1 — the commerce pack registers through `AssistantPackRegistry` with no special case (typed `AssistantDomainPack` assignability).
- AC2 — a store whose merchant is `pending` or `suspended` is never returned to consumers.
- AC3 — a `suspended` store is never returned to consumers; the verified/active store is (positive control).
- AC4 — the façade exports only `createCommercePack` and the boundary allow-list has no `domains/commerce` entry (the generic `test/domain-boundary.test.ts` walks `domains/**`).

ADR compliance: 0001 (merchant as seller of record), 0003 (second domain pack), 0099 (one façade / boundary), 0100 (verification gating, `domains/commerce`, vocabulary).

## Comments

- 16 Oct 2026 (agent): `npm run check` is clean and `test/commerce-merchant-store.test.ts` passes (4/4). `test/domain-boundary.test.ts` AC4 confirms the only unlisted deep imports are `.delta/worktrees/*` copies of the existing `guest-identity-assurance` exception — zero `domains/commerce` violations. The full `npm test` run cannot be green in this session for two pre-existing, environmental reasons unrelated to this slice: (1) `.delta/worktrees/` (concurrent sessions' `enter_worktree` checkouts) is not in the boundary test's `SKIP_DIRECTORIES`, so AC4 scans those copies; (2) several `apps/local-guest` server tests require `PAYSTACK_SECRET_KEY`, which is not set in this shell. Neither was introduced here; left `Status: claimed` rather than `resolved` until the suite can be run green.
