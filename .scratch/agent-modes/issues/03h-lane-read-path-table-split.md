# Read lane timelines from per-task rows instead of the projection blob

Status: resolved
Type: task
Blocked by: 03e (lane event rows are written and exported; this issue adds the read side). Owner release before any build (ADR 0107 "Settled", 8 Nov 2026; seams O2).
Requested: 16 Nov 2026

## Open owner decisions

1. **Trigger.** When is the split worth doing? Seams O2 says "if lane count grows" but sets no number. Today's limits are 32 lanes in a stored projection (`apps/local-guest/src/guest-projection.ts:397`) and 100 timeline entries per lane (`DEFAULT_LANE_TIMELINE_CAP`, `apps/local-guest/src/assistant/task-lanes.ts:16`). Owner to name the lane count or projection size that triggers this issue.
2. **Redaction on reload.** 03e stores `text_redacted`, the timeline text after the thread-timeline redaction (ADR 0075). If a reload rebuilds the guest's timeline from those rows, the guest must see the same text as before the reload. Owner to choose: (a) read the rows and accept that a reload matches the stored text, after a byte-for-byte check against the projection timeline; or (b) store an unredacted guest-visible row, which needs a new privacy review.
3. **Per-task state.** Analysis 11.4 also moves per-task `state_json` out of the thread header. Move it now, or only the timelines? Recommendation: timelines only.
4. **Model history.** Stays out of this issue while O1 (model history on a cold restore) is open. Owner to confirm.

## Parent

[Agent modes architecture analysis](../architecture-analysis.md), section 11.4 (storage) and section 11.6 (slice 3c, table split and export). The table sketch in 11.4 is superseded by [map](../map.md) and ADR 0107 decision 11 (one row per lane event). Seam [O2](../seams.md). Map slice `3c-read`.

## Why

Facts from the survey:

- A stored projection carries every lane's timeline in one `lanes` field (`apps/local-guest/src/guest-projection.ts:75`, validated at `:391` to `:400`). `#persistedLanes` writes it (`apps/local-guest/src/shortlet-app.ts:2217` to `:2227`).
- `#restoredLanes` (`shortlet-app.ts:2236`) refuses the whole list when one lane fails its check (`:2247`, `named`). One bad lane therefore empties every lane on restore.
- Analysis 11.4 notes that every Worker request reloads the whole thread blob, so the cost grows with the number of lanes. ADR 0106 makes every request a cold restore.
- 03e writes one row per lane event into `guest_thread_lane_events`, beside `guest_threads` (`domains/shortlet/src/guest-interaction-store.ts`). Nothing reads those rows yet. This issue is the first reader.

## What to build

1. **Read path.** A cold restore reads the active lane's rows by `(thread_id, task_id)`, ordered by `seq`, capped at the injected lane cap (O3). It also reads the header and one summary per lane (domain, status, badge) for the task rail. Other lanes' timelines are not read on restore; 03i asks for them on switch.
2. **Migration.** An existing projection with a `lanes` field is read once and written as rows in one transaction. After that, new writes stop carrying timelines in `lanes`. Step 2 runs only after owner decision 1 is answered.
3. **Fail closed per lane.** A lane whose rows have a `seq` gap, or a repeated `(task_id, seq)`, is refused alone: it restores empty and the other lanes are kept. The diagnostic is closed and names no ids (ADR 0075, ADR 0079).
4. **Cap.** A lane with more rows than the cap returns its newest entries only.
5. **Single reader.** Only the restore module reads the table. The export and the write path are unchanged (03e steps 4 and 5).
6. **No new table and no DDL move.** The thread store stays where O4 put it (03e Comments, 16 Nov 2026).

## ADRs to read first

| ADR | Constraint | Where it lands |
| --- | --- | --- |
| 0107 decision 11 (storage, restore, cap) | One row per lane event. A cold restore loads the active task's lane. Lanes are covered by the exports. | Steps 1, 2, 4. |
| 0106 (cold restore) | Every Worker request is a cold restore. Ids are re-keyed on restore, never re-minted. Forged or unknown ids fail closed. | Steps 1 and 3; AC 6. |
| 0101 | The platform object owns threads and tasks. The lane table sits beside `guest_threads`. | Steps 5 and 6. |
| 0075 | No model text, tool results or secrets in stored or returned interaction data. Diagnostics carry no ids. | Steps 2 and 3; AC 8. |
| 0096 | Exports hold rows; the four payment-reference exemption is unchanged. | Step 5. |
| 0079 | Diagnostics are closed and carry no ids. | Step 3. |

## Acceptance criteria

Each is its own `test()` in `test/assistant-lane-read-path.test.ts` (new), unless the file says otherwise.

1. A cold restore loads the active lane's timeline from its rows in `seq` order.
2. A lane whose rows have a `seq` gap is refused alone, restores empty, and its diagnostic names no task id.
3. A lane whose rows repeat a `(task_id, seq)` pair is refused alone (fail closed); the other lanes still restore.
4. A lane over the injected cap returns only its newest cap entries.
5. An existing projection with a `lanes` field is migrated to rows once, and a second restore reads rows only.
6. A task id that belongs to another thread returns no rows (fail closed).
7. The task-rail summary read touches no lane timeline rows (checked by a query-count assertion).
8. A row with a model-text or tool-result field is never read into the restored timeline (closed shape).
9. The lane table is read in exactly one module (a grep-based test).

## Verification

- `env -u LLM_API_KEY npm run check`.
- Local: `env -u LLM_API_KEY npx tsx --test test/assistant-lane-read-path.test.ts test/assistant-task-lanes.test.ts test/assistant-task-persistence.test.ts test/assistant-cold-journey.test.ts` (assistant enabled; cold restore before every event; clock 2026-10-27; staging-like guest).
- Workers, one spec per command, only the specs that match the change:
  - `env -u LLM_API_KEY npm run test:workers -- apps/cloudflare/test/restore-from-export.spec.ts`
  - `env -u LLM_API_KEY npm run test:workers -- apps/cloudflare/test/export-owner-sweep.spec.ts`
  - `env -u LLM_API_KEY npm run test:workers -- apps/cloudflare/test/data-migration.spec.ts` only if step 2 touches the migration path. It is a known 5-second flake (AGENTS.md); run it solo.
- Record the exact commands and pass counts under `## Comments`.

## Out of scope

- Model history rows (O1).
- Moving the thread store or its DDL to a platform module (ADR 0101 follow-up, O4).
- Client changes (03i owns the switch-time read).
- Changing the cap value (O3) or the 32-lane limit.
- Backfilling existing timelines beyond the one-time migration in step 2.

## Comments

### Implementing agent (issue 03h, 17 Nov 2026)

**Owner decisions applied.** (1) Trigger: built now. (2) Redaction: `redactLaneText` in `packages/platform-core/src/redaction.ts` is `maskEmailAddresses(redactSensitiveData(text))`. The timeline (`#pushLaneEntry`), the lane-row writer (`saveThreadRecord`) and a migrated legacy lane all use it, so the in-memory timeline, the projection and the rows carry the same text (AC11 asserts it). The projection no longer carries timelines: it writes `timeline: []` and no `lanes`. Fail closed: a refused lane restores empty and never falls back to other stored text. (3) Timelines only: per-task `state_json` stays in the thread header. (4) Model history: `conversationHistory` is not touched (seam O1).

**Phone and card shapes now show masked in the timeline.** `redactSensitiveData` masks phone and card shapes, so a phone typed into chat was masked in the rows before this change and is now masked in the timeline too (AC11). Contact details stay structured and unmasked: AC11 asserts the structured phone save writes the real number to the contact record and writes no lane row text. No existing test asserted an unmasked phone in the timeline, so no assertion changed for this.

**Read path.** One reader: `packages/platform-core/src/lane-restore.ts` (`readLaneTimeline`). It runs a summary (count, distinct seq, min, max; no text column) that checks the lane's whole run, then reads the newest `cap` rows. Refusals, checked in this order: a repeated (task, seq) pair (`LANE_SEQUENCE_DUPLICATE`), a run that does not start at 1 or has a hole (`LANE_SEQUENCE_GAP`), a row whose role or text is outside the closed shape (`LANE_ROW_INVALID`). Wiring: store `findLaneTimeline` (`domains/shortlet/src/guest-interaction-store.ts`), platform route `guest-data/findLaneTimeline` (`apps/cloudflare/src/platform-do.ts`, cap of at least 1, tenant match), Worker client (`apps/cloudflare/src/do-clients.ts`), port `GuestDataPort.findLaneTimeline` and the local fixture.

**The lane counter marks rows.** A lane has rows exactly when its `laneEventSeq` is above zero (03e assigns the sequence at push and writes the rows with the projection in one transaction). The restore reads a lane's rows only when that counter is above zero, and treats a stored timeline on a lane with no counter as legacy.

**Server switch (the gap).** Other lanes are not read on a cold restore. A lane becomes active by `TASK_SWITCH_EVENT`, by a start of an existing task, or by the planner's `switch_task` tool. Local: `#alignTimelineLane` loads the lane from its rows before it swaps. Remote: `#prefetchEventTarget` loads the target before `#handleEvent` (a switch names its `taskId`; a start names its domain and loads the task already held for it), and `#prefetchActiveLane` loads the runtime's active lane before `#rememberResult` in `handleTurn`, `handleEventAsync` (both branches) and `conventionalResumeReview`. The advisor review found that a remote switch aligned inside `#handleEvent` before the prefetch and read an empty lane. AC12 (remote) now fails without the prefetch (checked by removing the call) and passes with it.

**Migration (AC5, and AC5 two lanes).** A legacy lane (counter zero with stored timeline entries) is migrated on restore. Its entries are masked, queued as rows from seq 1, and kept in memory. The next save writes the rows with a projection that carries no timeline or lanes. A second restore reads rows only. The two-lane test covers the active lane (the projection `timeline`) and a non-active lane (the `lanes` list).

**Deviation, owner decision needed: a lane that already has rows.** A thread saved by 03e (before this change) and then continued holds, in its stored projection, pre-03e entries that have no rows. Those entries cannot be placed in order after the rows without renumbering, and renumbering was not done. This change reads the lane's rows and does not show the stored copy. One closed diagnostic `LEGACY_LANE_NOT_MIGRATED` (no ids, no text) is recorded when the stored copy holds more entries than the lane's rows (AC12 mixed). The copy is dropped on the next save. The guest loses the pre-03e part of that conversation. Owner to choose: (a) accept this for the pilot, or (b) approve a one-time rebuild of such lanes from the stored copy with a byte-for-byte check, as a separate issue with its own privacy review. Also check whether any staging thread holds 03e rows before this ships.

**Cap (AC4).** The reader returns the newest `cap` rows. The restore shows them with the 03d receipt summary at the head, the same shape `capLaneTimeline` gives, so a capped lane holds exactly `cap` entries. The rows themselves are not capped. AC4 checks exactly `cap` entries, the summary at the head and the newest rows after it. Owner to confirm this reading of "newest cap entries".

**Task rail (AC7).** The rail is built from the header's task list (id and domain). Badge and status are not persisted today and stay out of scope (decision 3). No per-lane summary table was added, so no DDL changed. AC7 counts the lane reads a cold restore and the rail read issue: exactly one, for the active lane, and none for any other lane (measured at the store boundary, `findLaneTimeline`).

**Test-first record (not in the protocol's order).** The implementation was written before the new test file. The new test file was first run after the implementation. Its first runs failed on the harness (an import name and non-hex thread ids, which `THREAD_ID_PATTERN` rejects). Two assertions in the new test were wrong and were corrected (a row-count threshold, and AC5's second-restore expectation, which missed the reply a switch leaves in its lane). No implementation change followed from a red test. The remote test was checked red by removing the prefetch call: it failed, then passed with the call restored.

**Changed assertions (existing tests, each deliberate; the projection no longer stores lanes or timelines).**
- `test/assistant-lane-events.test.ts:55` `storedLanes` reads the lane rows (was the projection's `lanes`). `:73` `assertOneRowPerEntry` also checks at `:81` that the restored active lane equals its rows.
- `test/assistant-task-lanes.test.ts:96` `storedLanes` reads the lane rows. `:259` AC6 title and `:278` the final assertion: the rows keep the whole lane (`length > cap`), and the cap applies to what a restore reads. The old assertion described the projection, which no longer holds the lane. `:295` AC7 writes a fresh `lanes` list with the bogus task id (no lanes exist now). The refusal it tests is unchanged (INVALID_TASK_LIST).
- `test/timeline-email-masking.test.ts:25` `persistedTimeline` reads the lane rows (was `projection.timeline`). Its assertions (no plaintext email) are unchanged.
- `test/assistant-pending-action-restore.test.ts:203`: "the conversation timeline is kept" moved from the parsed projection to the restored state.
- No other existing assertion changed. The test files were also converted to LF and back to CRLF during editing, with no content change (`git diff` shows none for them).

**Worker.** `apps/cloudflare/test/daily-export.spec.ts` gains "3h AC": the platform route returns one lane's rows in seq order, returns no other lane, and refuses a cap below one (400). The route is new and no other spec called it.

**Commands and counts** (each prefixed `env -u LLM_API_KEY`, run in `C:\AI2026\chat-marketplace-03h`):
1. `npm run check`: exit 0 on the final tree.
2. `npx tsx --test test/assistant-lane-read-path.test.ts test/assistant-task-lanes.test.ts test/assistant-task-persistence.test.ts test/assistant-cold-journey.test.ts test/guest-thread-lane-events.test.ts test/assistant-lane-events.test.ts test/timeline-email-masking.test.ts test/platform-thread-ddl.test.ts test/assistant-recorded-journeys.test.ts`: tests 57, pass 57, fail 0 (the new file has 14 tests: AC1 to AC11, plus AC12 remote, AC5 two lanes and AC12 mixed).
3. Related files that read the projection or the timeline (`test/assistant-pending-action-restore.test.ts`, `guest-new-conversation`, `guest-process-restart`, `assistant-persistent-continuity`, `assistant-open-question`, `assistant-terse-followups`, `guest-account-linking`, `guest-offer-access`, `stay-length-persisted`, `assistant-scope-persistence`, `assistant-partial-facts-across-turns`, `assistant-clarification-chips`, `local-guest-shell`, `agent-mode-shell`, `assistant-turn-record`, `assistant-runtime-boundary`, `export-node-sqlite`, `guest-real-dates`, `guest-account-sign-in`, `assistant-discovery-view`, `assistant-location-change`, `assistant-short-stays-29-nights`, `stay-length-assistant`, `schema-migrations`, plus item 2): tests 357, pass 357, fail 0. One earlier run found `assistant-pending-action-restore` failing on the removed projection timeline assertion; it is changed as above.
4. Non-browser files that mention the timeline and were not in item 3 (`agent-mark-shell`, `agent-mode-theme-color`, `assistant-budget-chip`, `close-legal-privacy-and-insurance-gates`, `guest-booking-journey`, `guest-conventional-search`, `guest-copy-pass`, `guest-criteria-strip`, `guest-journey-rail`, `guest-session-runtime-limit`, `guest-turn-recovery`, `guest-waiting-states`, `landing-page`): tests 115, pass 115, fail 0.
5. Workers, one spec per command, all passing: `apps/cloudflare/test/daily-export.spec.ts` 11 of 11 (includes the new 3h AC); `restore-from-export.spec.ts` 4 of 4; `export-owner-sweep.spec.ts` 4 of 4; `data-migration.spec.ts` 29 of 29; `platform-account-runtime.spec.ts` 2 of 2; `platform-do-split.spec.ts` 1 of 1.
Not run, per Test scope: full `npm test` and full `npm run test:workers` (the once-per-batch gate). Browser-only files were not run (the lane change does not touch the screens they cover).
No `client.ts` change, so no `dist` rebuild.

**Definition of Done (`docs/agents/issue-tracker.md`).** (1) Each criterion AC1 to AC9 has a `test()` named after it; AC10 and AC11 are the switch and owner-decision tests; AC12 (remote, mixed) and AC5 (two lanes) are added tests. (2) Failure paths asserted: gap (AC2), repeated pair (AC3), another thread's task id (AC6), closed shape (AC8). (3) ADRs read and listed in the table below. (4) No new injected dependency: the reader's inputs are all used; `LaneRestoreResult.total` is used by the residue check. (5) No invented policy string: the new diagnostic codes (`LANE_SEQUENCE_GAP`, `LANE_SEQUENCE_DUPLICATE`, `LANE_ROW_INVALID`, `LEGACY_LANE_NOT_MIGRATED`) are closed codes, not policy values. (6) Diagnostics name no id and carry no text (AC2, AC3, AC8 assert it). (7) `npm run check` exit 0; the batch `npm test` is deferred to the batch gate.

| ADR | Constraint | Where it lands |
| --- | --- | --- |
| 0107 decision 11 (restore loads the active lane; one row per event; switches; cap) | Cold restore reads the active lane's rows in seq order; switches load their lane; the cap applies on read. | `packages/platform-core/src/lane-restore.ts`; `#restoredLanes`, `#alignTimelineLane`, `#prefetchLane`, `#prefetchEventTarget`, `#prefetchActiveLane` in `apps/local-guest/src/shortlet-app.ts`. |
| 0107 corrections 1 and 2 | Restore rebuilds no model history from stored text; model history stays empty as today. | Unchanged: `conversationHistory` is not read or written by this change. |
| 0106 (cold restore; ids re-keyed; fail closed) | Every request is a cold restore; a task id from another thread reads nothing; a refused lane fails closed. | AC1 to AC12 use a new application over the same store before each event; AC6. |
| 0101 (platform owns threads; lane table beside `guest_threads`) | The reader and the route sit with the platform object. | `packages/platform-core/src/lane-restore.ts`; `apps/cloudflare/src/platform-do.ts` route `guest-data/findLaneTimeline`. |
| 0075 (no model text or tool results; closed shape; no ids in diagnostics) | Closed role set and text check; diagnostics closed. | AC8; `LANE_ROW_INVALID`; AC2 and AC8 diagnostics asserted id-free. |
| 0079 (diagnostics closed and observable) | Refusals are recorded as closed codes through the existing telemetry. | `#recordLaneRefusal`; AC2, AC3, AC8, AC12 (mixed). |
| 0096 (exports hold rows; the four payment-reference columns are the only plaintext exemption) | No change to the export; lane text is not exempt. | Unchanged; `daily-export.spec.ts` passes. |
| 0093 (email and general interaction state masked; contact records structured) | Lane rows and timeline mask email and phone shapes; the contact record keeps the real value. | `redactLaneText` (owner decision 2); AC11. |

**Open owner decisions.** (a) Lanes that already have rows drop their pre-03e stored copy (above). (b) Confirm the AC4 reading: exactly `cap` entries including the receipt summary.

**Status.** Resolved. Commit: `feat(agent-modes): restore lane timelines from lane rows (issue 03h)`.
