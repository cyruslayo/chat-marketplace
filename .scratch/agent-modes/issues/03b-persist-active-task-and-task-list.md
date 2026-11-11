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

### Agent, implementation (Agent modes issue 03b)

Status at this entry: `ready-for-agent`. It is not set to `resolved`: Definition of Done item 7 asks for a full `npm test` pass, which runs once per batch before merge (Test scope), and that gate has not run for this issue. See "Definition of Done" below.

**Baseline.** `env -u LLM_API_KEY npm run check` on `feat/agent-modes-03b` (1c12944, before any code change): exit 0.

**ADR table (step 1 read, step 3 mapped).** ADRs read in full: 0106, 0107 (with the 10 Nov corrections), 0075, 0093. 0099 and 0101 read for the decisions cited.

| ADR | Constraint | Where it lands |
| --- | --- | --- |
| 0106 (cold restore, AGENTS "Concierge assistant path") | Every request is a cold restore; ids the guest holds are re-keyed, never re-minted. | `assistant-runtime.ts` `restoreShortletState` keeps each persisted id (AC4). |
| 0106 (guards) | Forged, unknown or superseded ids fail closed. | Unknown task id on a switch returns `UNKNOWN_TASK` after a cold restore (AC8). A list naming no active task is refused (AC5). |
| 0107 decision 2 | The mode is derived from `activeTaskId`; the client never sets it. | `persistedTasksFor` writes the server's `activeTaskId`; no client field is read. |
| 0107 decision 11 and correction 1 | Restore by `activeTaskId` is the target; persisted ids are the first half. | Ids and domains persisted (AC1); the lane (03d) is not built here. |
| 0075, 0093 | Minimal projection; no task state, timeline or text in the store. | `parsePersistedTaskList` accepts only `taskId` and `domain` (AC1, AC7). |
| 0099 decision 4 | The platform owns threads and tasks. | Task list stays in the platform thread state; store location unchanged (0101). |
| 0074 | Fail-closed proposals and ids. | A refused list creates no task and no thread (AC5, AC6, parse-gate test). |

**Files changed.**

- `apps/local-guest/src/assistant/assistant-runtime.ts`: `PersistedAssistantTask`, `TaskRestoreRefusal`; optional `tasks` and `activeTaskId` on `AssistantShortletRestoreInput`; `taskListRefusal` (closed codes `INVALID_TASK_LIST`, `UNKNOWN_DOMAIN`, `UNPARSEABLE_STATE`); `persistedTasksFor`; `restoreShortletState` checks the whole list before any change, then rebuilds the tasks keeping each id. A legacy input (no list) restores one `shortlet` task with id `task-1`, as before.
- `apps/local-guest/src/guest-projection.ts`: optional `activeTaskId` and `tasks` on `GuestPersistentProjection`; `parsePersistedTaskList` (both fields or neither; malformed rejects the projection).
- `apps/local-guest/src/shortlet-app.ts`: `GuestThreadState.assistantTasks`; `#hydrateThreadRecord` carries the list; `#projectionFor` writes the runtime's list; `#restoreAssistantFromGuestThread` restores a persisted list even without stays context (new path, see Deviations); the stays restore passes the list.
- `test/assistant-task-persistence.test.ts` (new): AC1 to AC8 and the carried "cannot parse" test, one `test()` each.
- `test/helpers/booking-render-fixtures.ts` (new): shared artifacts for the four booking kinds (no copied fixtures).
- `test/assistant-pack-contract.test.ts`: carried AC7 test for the four booking kinds (surfaces output equals the legacy methods).
- `test/helpers/guest-date-fixtures.ts`: optional `additionalPacks` on `datedFixture` and `restartedDatedApp`; the existing callers are unchanged.
- `test/assistant-runtime-boundary.test.ts`: the `domain literal shortlet` allowlist count goes from 2 to 1. The two checks became one `STAYS_DOMAIN` constant, and the boundary test fails on a stale count. The follow-up is still issue 07.

Not touched: `commerce-assistant-pack.ts`, `apps/local-guest/dist/*`, `_headers`, screenshots, any Cloudflare code.

**Test-first.** The tests were written before the code. I did not capture a separate red run before implementing; the first run was after the implementation. Each test name mirrors its criterion.

**Verification (all from `C:\AI2026\chat-marketplace-03b`, `env -u LLM_API_KEY`).**

1. `npm run check`: exit 0 before the change, exit 0 after the boundary allowlist edit, and exit 0 again on the final tree.
2. `npx tsx --test test/assistant-task-persistence.test.ts test/assistant-pack-contract.test.ts`: tests 17, pass 17, fail 0 (9 persistence, 8 pack contract, one of them new). Rerun after the CRLF normalisation: tests 17, pass 17, fail 0.
3. `npx tsx --test test/assistant-task-persistence.test.ts test/assistant-persistent-continuity.test.ts test/assistant-task-rail.test.ts test/assistant-pending-action-restore.test.ts`: tests 24, pass 24, fail 0.
4. `npx tsx --test test/assistant-cold-journey.test.ts test/agent-mode-shell.test.ts`: tests 13, pass 13, fail 0.
5. `npx tsx --test test/assistant-pack-contract.test.ts test/assistant-pack-registry.test.ts test/assistant-runtime-boundary.test.ts`: tests 16, pass 16, fail 0.
6. Regression sweep of the 23 test files that build a restored app or call the restore or task rail (`test/assistant-*` and related; list in the scratchpad): tests 171, pass 170, fail 1. The one failure was `assistant-runtime-boundary.test.ts`, "the platform files match the named boundary allowlist exactly", which is the allowlist change in the file list above. After that edit, `test/assistant-runtime-boundary.test.ts` runs 5 of 5 pass. The sweep was not rerun in full after the edit.
7. Worker: `npm run test:workers -- apps/cloudflare/test/data-migration.spec.ts` (Worker-visible: the projection JSON the Durable Object stores). First run 26 of 29 pass, with three `Test timed out in 5000ms` failures (AC1 and two D1 tests) while another session was building in a sibling worktree. Solo rerun: 29 of 29 pass. This is the 5-second load flake that AGENTS.md records for this spec. No Cloudflare code was changed.
8. Not run, per Test scope: full `npm test` and the full `npm run test:workers`. They run once per batch before merging to main.

**Definition of Done (`docs/agents/issue-tracker.md`).**

1. Every acceptance criterion has a named test: met. AC1 to AC8 and the two carried clauses (cannot-parse, four booking kinds) each have one `test()`.
2. Failure paths asserted: met. AC5 (`INVALID_TASK_LIST`, no thread), AC6 (`UNKNOWN_DOMAIN`, no thread), AC7 (three malformed variants, no state), AC8 (`UNKNOWN_TASK`), cannot-parse (`UNPARSEABLE_STATE`, no thread).
3. ADRs listed and cited: met (table above).
4. No unused injected dependency: met. No constructor parameter added.
5. No invented policy string or constant: partly met. The new codes are closed internal diagnostics, not guest copy. The bounds in `parsePersistedTaskList` (at most 32 tasks; ids and domains up to 120 characters) are engineering limits, not domain policy, and no ADR sets them. This is a gap for the owner to confirm or source. The `task-1` and `shortlet` values are existing code, now named as constants.
6. No credential or identity material in logs: met (no logging added; ids only, as in ADR 0107).
7. `npm run check` clean: met. `npm test` passes: not run per issue (batch gate). This is the open item.

**Deviations and open points (for the owner).**

- Non-stays task state. The restore does not store the pack's `initialState()`. It checks it with the pack's `parseState` (the cannot-parse gate) and stores `createInitialTaskState()`, because `AssistantTask.state` is the platform's stays-shaped state until per-task state arrives with lanes (03d). The shop fake pack's `{ items: [] }` is therefore validated, not stored.
- A refused restore resets the assistant side of the thread. Per the spec ("the thread is not restored with it"), an unregistered domain (for example commerce, when `COMMERCE_ENABLED` is off) makes `restoreShortletState` return false, and the thread's stays state is not restored either. The next save then writes the runtime's default list. The guest timeline is still restored. Please confirm this is the intended fail-closed behaviour, or ask for a separate "task parked" state.
- A thread with no stays context but a persisted list now restores that list (a shop task started before any stays search). A legacy thread with neither is unchanged. This widens which threads the runtime restores. The 23-file sweep passed, but it is the one behaviour change outside the spec's list.
- `restoreShortletState` keeps its `boolean` return (AC5 says "returns false"). The closed reason comes from `taskListRefusal`, which the tests call.

**Scope notes.** No formatter was run. No file under `apps/local-guest/dist/` or `_headers` changed. Nothing was pushed or merged.
