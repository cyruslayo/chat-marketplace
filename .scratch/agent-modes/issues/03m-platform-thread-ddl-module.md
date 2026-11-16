# Move the platform-owned thread DDL out of the shortlet domain store

Status: needs-triage
Type: refactor (no functional change: tables, columns, migrations, data and exports are unchanged)
Requested: 17 Nov 2026

## Parent

[ADR 0101](../../../docs/adr/0101-multi-domain-cloudflare-hosting-and-platform-accounts.md) (platform ownership of accounts, sessions and the thread store); seams.md O4 (closed by owner decision, 16 Nov 2026); [03e Comments](03e-lane-event-rows-and-export.md) (the lane table was placed beside `guest_threads` pending this move). Map slice `O4-ddl`.

## Why

Facts from the 03e work and the seams O4 decision:

- The DDL for `guest_threads` and `guest_thread_lane_events` lives in the shortlet bounded context: `domains/shortlet/src/guest-interaction-store.ts` (`CREATE TABLE guest_threads` at `:412`, `CREATE TABLE guest_thread_lane_events` at `:387`).
- ADR 0101 and `PLATFORM_EXPORT_TABLES` (`apps/cloudflare/src/do-export.ts:70`) treat the thread store as platform-owned; the same file lists both tables for the platform exports.
- The owner closed O4 on 16 Nov 2026: the thread store is platform-owned, and moving the DDL into a platform module is this follow-up. 03e's lane table deliberately followed the existing placement so this move takes both tables together.

## What to build

1. **Move the DDL only.** The `CREATE TABLE` definitions for `guest_threads` and `guest_thread_lane_events`, and the wiring that registers them with the platform schema version and migrations (`PLATFORM_SCHEMA_VERSION` 5, platform migration 5 from 03e), move into a platform module. No column, constraint, migration number, index or data change.
2. **One definition.** After the move, the DDL exists in exactly one place. The domain store either imports the definitions from the platform module or calls platform registration helpers; it no longer carries its own copy.
3. **Exports unchanged.** `PLATFORM_EXPORT_TABLES` and every export test keep passing without modification.
4. **No behaviour change.** Every existing test passes unmodified. If any test would need to change, stop and record the reason in Comments first.

## Open owner decisions

1. **Destination.** Which module owns the DDL: `packages/platform-core` beside the redaction and export helpers, or the Cloudflare platform code that owns the Durable Object. Recommendation: `packages/platform-core`, so the definition is testable from node without a Worker harness.
2. **Companions.** `guest_session_bindings` (also platform-owned under ADR 0101/0093) sits in the same domain file. Move it in the same pass, or leave it for a second pass? Recommendation: move it in the same pass, since it shares the ownership argument, but keep this issue's test scope to the two thread tables.
3. **Domain store shape.** Whether the shortlet store keeps thin wrapper helpers (current call sites unchanged) or imports the platform module directly. Recommendation: wrappers first, so this stays a pure move.

## ADRs to read first

| ADR | Constraint | Where it lands |
| --- | --- |
| 0101 | The thread store, accounts and sessions are platform-owned; the domain never owns their persistence. | Steps 1 and 2. |
| 0107 decision 11 | Lane storage is one row per event and covered by the exports. | Step 3; the lane table moves with `guest_threads`. |
| 0096 | Evidence and private export coverage for the lane rows. | Step 3; export tests unchanged. |

## Acceptance criteria

Each is its own `test()` where a test applies (this is a refactor; several criteria are greps and unchanged suites).

1. A grep test finds no `CREATE TABLE guest_threads` or `CREATE TABLE guest_thread_lane_events` outside the platform module.
2. The platform schema version and migrations are unchanged (`PLATFORM_SCHEMA_VERSION` 5; the same migration list hashes).
3. `npm run test:workers -- apps/cloudflare/test/data-migration.spec.ts` and the export specs pass unmodified.
4. The 03e lane tests (`test/guest-thread-lane-events.test.ts`, `test/assistant-lane-events.test.ts`) and the thread-store tests pass unmodified.
5. `npm run check` is clean.

## Verification

- `env -u LLM_API_KEY npm run check`.
- `env -u LLM_API_KEY npx tsx --test test/guest-thread-lane-events.test.ts test/assistant-lane-events.test.ts` plus the thread-store and task-persistence files they share helpers with.
- `env -u LLM_API_KEY npm run test:workers -- apps/cloudflare/test/data-migration.spec.ts` and the export-owner specs.
- Record the exact commands and pass counts under `## Comments`.

## Out of scope

- Any schema or migration change, including backfills.
- The lane read path (03h).
- Moving `guest_booking_request_contacts`, request drafts, offers or any booking-owned table: those are domain records under ADRs 0092/0093, not platform state.

## Comments
