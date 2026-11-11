# Persist the active task and the task list across a cold restore

Status: ready-for-agent
Type: task
Blocked by: 03a (pack-owned `initialState` is used for a restored non-stays task). Owner release as in 03a (ADR 0107 "Settled", 8 Nov 2026).
Requested: 10 Nov 2026

## Parent

[Agent modes architecture analysis](../architecture-analysis.md), section 11.1 and 11.6 (slice 3b, part 1); [ADR 0107](../../../docs/adr/0107-present-each-domain-pack-as-an-agent-mode.md) decisions 2 and 11 (see the dated corrections in ADR 0107, which record that restore by `activeTaskId` is not current behaviour); [map](../map.md) slice 3b.

## Why

ADR 0107 decision 2 says the mode is derived from `activeTaskId`, so a cold restore (ADR 0106) can rebuild it. The code does not persist it:

- `GuestPersistentProjection` (`apps/local-guest/src/guest-projection.ts`, interface near line 19) has no `activeTaskId` and no `tasks`.
- `#projectionFor` (`apps/local-guest/src/shortlet-app.ts:2515` to `:2553`) writes only the guest fields, no task fields.
- `restoreShortletState` (`apps/local-guest/src/assistant/assistant-runtime.ts:736`) finds the single task with `domain === "shortlet"` (or `tasks[0]`) and sets `activeTaskId` to it. A non-stays active task cannot survive a restore: the method returns `false` when that task is not the shortlet one.
- `getThread` creates the initial task as `taskId: "task-1"` (`assistant-runtime.ts`, around line 700).

The projection is stored in `guest_threads.thread_json` (`domains/shortlet/src/guest-interaction-store.ts:372` DDL, upsert near `:738`).

## What to build

1. **Projection fields.** Add optional `activeTaskId?: string` and `tasks?: readonly { taskId: string; domain: string }[]` to `GuestPersistentProjection`. Ids and domains only: no task state, no timeline, no text. Parse them fail closed: a malformed list rejects the projection, as an invalid projection is rejected today.
2. **Write.** `#projectionFor` writes both fields from the thread's task list.
3. **Legacy blobs.** A stored blob with neither field restores as one task with domain `shortlet` (the stays pack id, `shortlet-assistant-pack.ts:1520`), taking the existing restore path unchanged.
4. **Re-key, never re-mint.** `restoreShortletState` accepts the persisted `activeTaskId` and `tasks`. The persisted ids are kept as they are. A task whose `domain` is not registered is refused with the existing `UNKNOWN_DOMAIN` path. An `activeTaskId` that is not in `tasks` is refused and creates no task (fail closed).
5. **Non-active tasks restore identity only.** A restored non-active task starts from the pack's `initialState()` (03a). This is a stated limit: per-task state persistence arrives with lanes (03d). Record it in Comments.
6. **Guard unchanged.** A client event naming a task id from another thread keeps returning `UNKNOWN_TASK` (`assistant-runtime.ts:557`).

## ADRs to read first

| ADR | Constraint | Where it lands |
| --- | --- | --- |
| 0106 and AGENTS.md "Concierge assistant path" (cold restore before every event) | Every Worker request is a cold restore. Ids the guest holds are persisted and re-keyed, never re-minted. | Steps 2 and 4. |
| 0106 (guards) | Forged, superseded or unknown ids fail closed as `STALE_SURFACE` or `ARTIFACT_MISMATCH`. | Step 4; the task-id guard uses `UNKNOWN_TASK`, which is the existing task-switch code. |
| 0107 decision 2 | The mode is derived from `activeTaskId`. A client never sets it. | Step 1 persists it; the client is not involved. |
| 0107 decision 11 | Restore by `activeTaskId` is the target behaviour. | This issue is its first half (ids). |
| 0075 | Minimal projection. Only safe ids and domains are persisted. | Step 1 adds no text or state. |
| 0093 | Guest persisted state is minimal and server-owned. | Same. |
| 0099 decision 4 | The platform owns threads and tasks. | Task list stays in the platform thread state. |
| 0101 | Platform owns threads and tasks; the store location is a follow-up (see 03e). | No store move in this issue. |

## Acceptance criteria

Each is its own `test()` in `test/assistant-task-persistence.test.ts`.

1. The stored projection holds `activeTaskId` and `tasks` with `taskId` and `domain` only; the stored JSON has no `state`, `timeline` or `conversationHistory` under a task.
2. With the fake shop task (`createFakeShopPack`) active, a cold restore (new `LocalGuestApp` over the same store) leaves the shop task active.
3. A legacy stored blob with neither field restores to one `shortlet` task, active.
4. A cold restore keeps the persisted `taskId` unchanged; it does not mint a new id.
5. A stored `activeTaskId` that is not in `tasks` is refused: the restore returns `false` and no task is created (fail closed).
6. A stored task whose domain is not registered is refused with `UNKNOWN_DOMAIN`, and the thread is not restored with it.
7. A malformed `tasks` list (non-string id, extra key, array instead of object) rejects the projection, as an invalid projection is rejected today.
8. A client `platform.task.switch` naming a task id from another thread returns `UNKNOWN_TASK` after a cold restore.

## Verification

- `env -u LLM_API_KEY npm run check`.
- `env -u LLM_API_KEY npx tsx --test test/assistant-task-persistence.test.ts test/assistant-persistent-continuity.test.ts test/assistant-task-rail.test.ts test/assistant-pending-action-restore.test.ts`.
- `env -u LLM_API_KEY npx tsx --test test/assistant-cold-journey.test.ts test/agent-mode-shell.test.ts` (AC7 is the cold-restore mode check). Assistant enabled, cold restore before every event, clock 2026-10-27, staging-like guest with no seeded phone or email.
- If the thread store write path is touched in a Worker-visible way, also `npm run test:workers -- apps/cloudflare/test/data-migration.spec.ts` (verify this is the right spec; a 5-second spec flagged in AGENTS.md may need a timeout note, not a fix).
- Record commands and counts under `## Comments`.

## Out of scope

- Per-task timelines and model history (03d).
- Lane event rows and export (03e).
- Client rendering of the task list (03c, 03g).
- Changing the existing `restoreShortletState` input for stays fields.

## Comments

### Carried from 03a (owner deferral, 11 Nov 2026)
- Add the test "a restore that cannot parse its state creates no task" (03a AC3 clause).
- Add a surfaces-equals-legacy test for the four non-`pending_action` booking kinds using a shared render fixture helper.
