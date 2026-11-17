# Move the platform-owned thread DDL out of the shortlet domain store

Status: resolved
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

### Implementing agent (issue 03m, 17 Nov 2026)

**ADR table (protocol step 2).** Read: ADR 0101 (platform owns the thread store, accounts and sessions; the domain never owns their persistence), ADR 0107 decision 11 (one row per lane event, covered by the exports), ADR 0096 (private export coverage of lane rows), ADR 0093 (session binding and account placement, read for the companions). Constraints and where they land:

| ADR | Constraint | Code path |
| --- | --- | --- |
| 0101 | Thread store, accounts, sessions are platform-owned. | `packages/platform-core/src/thread-schema.ts` owns the DDL; `apps/cloudflare/src/schema.ts` platform migration 1 and 5 apply it. |
| 0107 d11 | Lane storage is one row per event, covered by the exports. | `LANE_EVENT_SCHEMA` moved verbatim; `PLATFORM_EXPORT_TABLES` unchanged. |
| 0096 | Lane rows are in the private export. | Export lists unchanged; `daily-export.spec.ts` passes unmodified. |
| 0093 | Session bindings store only the salted hash. | `guest_session_bindings` DDL moved verbatim; no column change. |

No ADR was overridden. Booking-owned tables (`guest_booking_request_contacts`, drafts, requests, offers) stay in the shortlet store.

**Decisions (owner, 17 Nov 2026, applied).**
1. Destination: `packages/platform-core/src/thread-schema.ts`. It imports nothing, so it is testable from node.
2. Companions: `guest_session_bindings` moved in the same pass. It sits in the same `THREAD_SESSION_SCHEMA` block, so the move is one verbatim text block (lines 382 to 421 of the old store file).
3. Wrappers: `SqliteGuestInteractionStore` keeps every exported function (`saveThreadRecord`, `parseDurableLaneEvents`, the session and thread methods) and its constructor. It now imports `THREAD_SESSION_SCHEMA` from the platform module. The two DDL constants are no longer exported from the shortlet index (no other importer existed; `apps/cloudflare/src/schema.ts` now imports from the platform module).

**Deviation (recorded).** The platform migration list (`PLATFORM_SCHEMA_MIGRATIONS`) stays in `apps/cloudflare/src/schema.ts`, the composition root. It mixes platform-core, Cloudflare-only and quota statements, so only the DDL moved, not the list. The issue text asked for the wiring to move too; the owner decisions ask for a pure move with an unchanged migration list, which this honours.

**Pinned hashes (base commit ccd04f3, before the move).** `sha256(JSON.stringify(PLATFORM_SCHEMA_MIGRATIONS))` = `028d0183668adb08c9dc2aa4372c6c65ee2c75184c5778aecb94b1179c4906f0`; `sha256(JSON.stringify(SHORTLET_SCHEMA_MIGRATIONS))` = `0f9f6bc21fb505b388a32f17d1a21887a291c19695680a5cfa8c8fa7def3fb86`. Both are unchanged after the move. `PLATFORM_SCHEMA_VERSION` stays 5.

**Test-first record.** `test/platform-thread-ddl.test.ts` written first. Red run (before the move): `env -u LLM_API_KEY node node_modules/tsx/dist/cli.mjs --test test/platform-thread-ddl.test.ts`: tests 5, pass 4, fail 1. The failing test was AC1, with the shortlet store listed as the offender. Green after the move: tests 5, pass 5.

**Test scope exemption.** The grep test (AC1) scans `apps/`, `domains/`, `packages/` and `scripts/` production sources only. Test directories are excluded on purpose: `apps/cloudflare/test/legacy-single-do-fixture.ts` and `platform-account-runtime.spec.ts` build old single-object databases with their own `CREATE TABLE guest_threads`, and those are fixtures for legacy migration, not a second definition.

**Commands and counts (final tree).** Each prefixed `env -u LLM_API_KEY`, run in `C:\AI2026\chat-marketplace-03m`.
1. `npm run check`: exit 0 (tsc, tsc for apps/cloudflare, tests tsconfig, tooling tsconfig, worker bundle guard).
2. `node node_modules/tsx/dist/cli.mjs --test test/platform-thread-ddl.test.ts test/guest-thread-lane-events.test.ts test/assistant-lane-events.test.ts test/timeline-email-masking.test.ts test/assistant-task-persistence.test.ts test/assistant-task-lanes.test.ts test/guest-process-restart.test.ts test/sql-port-availability-interaction.test.ts test/sql-port-operator-stores.test.ts test/sql-port-store-imports.test.ts test/export-node-sqlite.test.ts test/schema-migrations.test.ts test/guest-account-sign-in.test.ts test/guest-account-linking.test.ts test/pilot-notifications.test.ts`: tests 204, pass 204, fail 0, skipped 0. This covers the two 03e lane suites (unmodified), the 03n masking suite (unmodified), the task-persistence and thread-store suites, the session-binding suites (guest-process-restart, guest-account-sign-in, guest-account-linking) and the migration suite.
3. `npm run test:workers -- apps/cloudflare/test/data-migration.spec.ts`: 29 of 29 passed.
4. `npm run test:workers -- apps/cloudflare/test/daily-export.spec.ts`: 10 of 10 passed.
5. `npm run test:workers -- apps/cloudflare/test/export-owner-sweep.spec.ts`: 4 of 4 passed.
6. `npm run test:workers -- apps/cloudflare/test/platform-do-split.spec.ts`: 1 of 1 passed.
7. `npm run test:workers -- apps/cloudflare/test/platform-account-runtime.spec.ts`: 2 of 2 passed (the platform object's session-binding and thread tables).
Not run, per Test scope: full `npm test` and full `npm run test:workers` (once-per-batch gate).

**Changed files.** `packages/platform-core/src/thread-schema.ts` (new; the three DDL statements moved verbatim, CRLF), `domains/shortlet/src/guest-interaction-store.ts` (DDL block removed, one import added; no other line touched), `apps/cloudflare/src/schema.ts` (one import path), `test/platform-thread-ddl.test.ts` (new).

**Definition of Done.** AC1 has a named grep test; AC2 has the version, hash and column tests; AC3 and AC4 are the unmodified suites listed above; AC5 is `npm run check` exit 0. No `any` added. No invented policy string. No logging change. No schema or migration change. No booking-owned table moved. `saveThreadRecord` is byte-identical.

**Status.** Resolved.
