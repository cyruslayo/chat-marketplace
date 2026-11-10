# Write one redacted row per lane event, exported with the platform tables

Status: ready-for-human
Type: task
Blocked by: 03d (lanes exist and carry a `taskId`). Open decisions O4 (thread store ownership, ADR 0101) must be answered before the placement in step 4 is final. Owner release as in 03a (ADR 0107 "Settled", 8 Nov 2026).
Requested: 10 Nov 2026

## Parent

[Agent modes architecture analysis](../architecture-analysis.md), section 11.4 (storage) as superseded by [map](../map.md) (decision 11: one row per lane event, not a JSON blob); [ADR 0107](../../../docs/adr/0107-present-each-domain-pack-as-an-agent-mode.md) decision 11 (storage); slice 3c.

## Why

ADR 0107 decision 11 stores each lane as one row per timeline or history event, not as a JSON blob, and says lanes are covered by the evidence and private exports (ADR 0096). This issue adds the write side and the export coverage. Its read path is out of scope: the app does not read these rows. The export does.

Facts from the survey:

- `PLATFORM_EXPORT_TABLES` (`apps/cloudflare/src/do-export.ts:70` to `:80`) lists `guest_threads`, `guest_contacts` and the account tables. The table selector is at `do-export.ts:330`.
- The `guest_threads` DDL is in the shortlet store, not the platform (`domains/shortlet/src/guest-interaction-store.ts:372`). ADR 0101 and the export list both say platform. This mismatch is open decision O4 and is not fixed here.
- `export-owner-sweep.spec.ts` (test "F9: every exported table has exactly one owner", near line 90) asserts one owner per exported table.
- The existing four payment-reference exemption (ADR 0096) applies only to the four named columns. Timeline text is not in that exemption.

## What to build

1. **Table.** `CREATE TABLE IF NOT EXISTS guest_thread_lane_events` beside the thread DDL in `domains/shortlet/src/guest-interaction-store.ts`. Columns: `event_id TEXT PRIMARY KEY`, `thread_id`, `tenant_id`, `task_id`, `domain`, `seq INTEGER`, `role` (one of `user`, `assistant`, `receipt`), `text_redacted`, `created_at`. Unique on `(thread_id, task_id, seq)`.
2. **Write-only.** Rows are inserted with `INSERT OR IGNORE` in the same transaction as the lane change (the thread upsert near `guest-interaction-store.ts:738`). No application code reads the table.
3. **Redaction before write.** `text_redacted` is the timeline text after the existing redaction used for the thread timeline (ADR 0075). Model text, tool results and A2UI are never written.
4. **One export owner.** Add `guest_thread_lane_events` to exactly one list. Default: `PLATFORM_EXPORT_TABLES`, beside `guest_threads`, because lanes belong to the thread (ADR 0107 decision 11). If O4 decides the thread store moves to the platform, this table moves with it. It must not appear in `SHORTLET_EXPORT_TABLES` and `PLATFORM_EXPORT_TABLES` at once.
5. **Duplicate and conflict.** A repeated `event_id` with the same content is ignored. A repeated `event_id` with different content rolls back the transaction and writes nothing (fail closed).
6. **Retention.** Rows follow the export retention (`DEFAULT_EXPORT_RETENTION_DAYS`, 400 days; ADR 0096). The app does not prune them in this issue.
7. **Restore runbook note.** Add one line to the restore runbook saying the table is restored from the export and is not read by the app. Verify the runbook path before editing (not located in the survey).

## ADRs to read first

| ADR | Constraint | Where it lands |
| --- | --- | --- |
| 0107 decision 11 (storage) | One row per lane event. Lanes are covered by the evidence and private exports. | Steps 1 and 2. |
| 0101 | Platform owns threads and tasks, and each domain owns its tables. The store placement is open (O4). | Step 4. |
| 0096 | The private export holds payment references in plaintext under four conditions. The exemption covers only the four named columns. Other data, including timeline text, follows ADR 0075. | Step 3: no payment reference is copied into lane text; AC3. |
| 0075 | No bearer credentials, secrets, prompts or replies in stored interaction data; redacted only. | Step 3. |
| 0095 | Data-protection gates apply to every object. Export holds synthetic or staging data only until they clear. | Verification and Comments note. |
| 0079 | Observability carries no ids in diagnostics. The table is data, not a diagnostic. | No diagnostic is added here. |

## Acceptance criteria

Each is its own `test()`. Worker specs run through `npm run test:workers -- <spec>`. Local specs run with `tsx --test`.

1. Each new active-lane timeline entry writes exactly one row with its `task_id`, `domain` and a sequence number.
2. Replaying the same `event_id` with the same content writes no second row; with different content the transaction rolls back and no row is written.
3. A timeline entry containing a synthetic phone number, email and token-shaped string is stored in its redacted form.
4. The table name appears in exactly one of `SHORTLET_EXPORT_TABLES`, `PLATFORM_EXPORT_TABLES` and `COMMERCE_EXPORT_TABLES`, and `export-owner-sweep.spec.ts` F9 passes.
5. The daily export writes the lane table to the key for the date (`daily-export.spec.ts`).
6. Only `user`, `assistant` and `receipt` timeline entries are written; a model-text or tool-result payload is refused, not written.
7. No code path in `apps/` or `domains/` reads the table (a grep-based test).

## Verification

- `env -u LLM_API_KEY npm run check`.
- Local: `env -u LLM_API_KEY npx tsx --test test/assistant-task-lanes.test.ts test/assistant-cold-journey.test.ts` (assistant enabled; cold restore before every event; clock 2026-10-27; staging-like guest).
- Workers, one spec per command, run only when the issue changes that code:
  - `env -u LLM_API_KEY npm run test:workers -- apps/cloudflare/test/export-owner-sweep.spec.ts`
  - `env -u LLM_API_KEY npm run test:workers -- apps/cloudflare/test/daily-export.spec.ts` (a known 5.7 s run against a 5 s limit; raise the timeout as AGENTS.md says, do not treat it as a regression)
  - `env -u LLM_API_KEY npm run test:workers -- apps/cloudflare/test/restore-from-export.spec.ts` (restore coverage)
- Record commands and counts under `## Comments`.

## Out of scope

- Any read path or table split for lanes (open decision O2).
- Moving `guest_threads` or the thread store to the platform object (ADR 0101 follow-up; open decision O4).
- Backfilling existing timelines.
- Any change to the four payment-reference exemption.

## Comments
