# Read lane timelines from per-task rows instead of the projection blob

Status: needs-triage
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
