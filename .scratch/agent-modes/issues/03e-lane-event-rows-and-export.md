# Write one redacted row per lane event, exported with the platform tables

Status: ready-for-agent
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

### Owner decision O4, 16 Nov 2026 (recorded by the implementing agent, word for word)

"The thread store is platform-owned (ADR 0101; PLATFORM_EXPORT_TABLES in apps/cloudflare/src/do-export.ts already lists guest_threads; ADR 0107 decision 11 puts lanes in the platform Durable Object beside the thread header). For this issue, the lane event table is created beside guest_threads in domains/shortlet/src/guest-interaction-store.ts and is listed in PLATFORM_EXPORT_TABLES. Step 4 is final on that basis. Moving the guest_threads and lane DDL into a platform module is a separate follow-up issue (ADR 0101), not part of 03e."

Other settled rules applied: O1 (model history is not restored), O2/O3 (reads still come from the `lanes` projection field; rows are write-only; the read-path split is 03h), O5 (New conversation is the client thread switch; no per-lane reset).

### Implementing agent (Agent modes issue 03e): ADR table and plan (steps 1 and 2)

Read in full: ADR 0107 (decision 11 and the corrections), ADR 0101, ADR 0075, ADR 0096 (conditions and the four-column exemption). Read in full: 0107, 0101, 0075, 0096, 0106, 0079, 0095. ADR 0093 was read in its projection, email and redaction clauses (its lines on interaction projections and on email addresses). The issue 03d Comments were read. `docs/agents/issue-tracker.md` and `docs/agents/coding-standards.md` read.

| ADR | Constraint | Where it lands |
| --- | --- | --- |
| 0107 decision 11 (storage) | One row per lane event, with task id, domain and a sequence; covered by evidence and private exports. | `guest_thread_lane_events` (store DDL); one row per pushed timeline entry (`#pushLane` in shortlet-app.ts). |
| 0107 decision 11 (isolation, restore) | Lanes are per task; no model text is stored; restore reads the lanes projection only. | Rows hold guest-visible timeline text only. Nothing reads the table (AC7). |
| 0101 | Platform owns threads; each domain owns its tables. Placement per O4. | DDL beside `guest_threads` in `THREAD_SESSION_SCHEMA`, listed in `PLATFORM_EXPORT_TABLES` only. Mounted in the platform object by migration 5 (see deviation 3). |
| 0096 | Export is plaintext only for the four named payment-reference columns. Timeline text is not exempt. | No payment reference is written to a lane row; the table is in no exemption list. |
| 0075 | No secrets, tokens, prompts, model text or raw contact data in stored interaction data; redacted only. | Writer applies `redactSensitiveData` to every row text (chokepoint in the store) before insert. Model text and tool results are refused by role (AC6). |
| 0093 | Minimal projection of guest state. | Row columns are ids, domain, sequence, role, redacted text, timestamp. No contact fields. |
| 0079 | Observability carries no ids. The table is data, not a diagnostic. | No diagnostic is added. |
| 0095 | Data-protection gates apply to every object; the export holds synthetic or staging data only until they clear. | Noted; no production data is written by this change. |

### Implementing agent: design and deviations (to confirm)

1. **Atomic write.** The thread upsert and its lane rows run in one transaction (`saveThreadRecord`, `database.transaction`), in both the local store and the Cloudflare platform object (`platform-do.ts` `saveThread`). This keeps the lane rows and the projection that names them together.
2. **Upsert, not INSERT OR IGNORE.** A replayed `event_id` is ignored only when its content is the same; a different content makes the upsert assign NULL to the NOT NULL `event_id`, so the whole transaction fails and rolls back. A second event on the same (thread, task, seq) also fails the unique index. The store never reads the table to check (AC7).
3. **Migration 5 for existing platform objects.** `THREAD_SESSION_SCHEMA` gains the table beside `guest_threads`, and platform migration 5 adds the same `IF NOT EXISTS` DDL so an already-deployed platform object (at version 4) gains it. `PLATFORM_SCHEMA_VERSION` becomes 5. This is an additive migration; no existing migration is edited.
4. **Sequence counter.** A per-lane sequence cannot be read back from the capped timeline (the cap trims the oldest entries), and the table cannot be read by the app (AC7). The next sequence per task is therefore kept in the thread projection as `laneEventSeq` (an additive optional field, validated on parse: task-id keys, non-negative safe integers). It is assigned when the entry is pushed, so a retried save writes the same rows, which the upsert ignores. Sequence gaps are possible after a failed save and are harmless.
5. **Domain of a row.** The lane's domain comes from the runtime's persisted task list. Without a runtime the lane is the initial stays lane, so the stays domain constant (`STAYS_DOMAIN`, already in assistant-runtime.ts, now exported) is used.
6. **Pending rows survive a failed save.** Pending rows are cleared only after the save succeeds, so a retry writes them again.
7. **Redaction is applied twice (shell and store).** The shell passes timeline text as the timeline holds it; the store applies `redactSensitiveData` before insert, so the store is the single fail-closed point. Note for owner: `redactSensitiveData` (packages/platform-core/src/redaction.ts) does not mask email addresses in free text (phone, bearer token and card shapes are masked). AC3 asks for email as well. See Open owner decisions.
8. **Role refusal.** The closed role set (`user`, `assistant`, `receipt`) is enforced in the parser used by the platform object (a bad role is HTTP 400 and nothing is written) and in the store writer (a throw, rolled back), and the table has a CHECK on `role`.

### Open owner decisions (not invented here)

- **OD-1 (AC3, email).** Should lane rows mask email addresses in free text? The ADR 0075 redactor masks phone, bearer and card shapes but not email. Options: (a) add an email rule to the one redactor (changes every redacted store, including audit and telemetry, and needs a decision on which mask text to use), or (b) limit the lane-row rule to email only. Until the owner decides, the AC3 email assertion is not made; phone and token are tested. ADR 0093 (interaction projections and email addresses) says email addresses never appear in general interaction state, and the thread timeline already stores typed guest text unredacted for email. The owner should decide the rule for the thread projection and the lane rows together.
- **Runbook line (step 7).** Added as the spec asks, in `docs/runbooks/cloudflare-restore.md` after the export-day paragraph. The wording can be changed by the owner in review; no decision is open on it.

### Implementing agent: test-first record (steps 2 and 3)

Red run before any implementation (`env -u LLM_API_KEY npx tsx --test test/guest-thread-lane-events.test.ts test/assistant-lane-events.test.ts`):
- The store file did not load: `SyntaxError: The requested module '../domains/shortlet/src/guest-interaction-store.js' does not provide an export named 'parseDurableLaneEvents'`. Result: tests 2, pass 0, fail 2 (the file-level failure).
- The shell file's AC1 failed at its first stays search: `stays search: expected success, saw INVALID_THREAD: Unknown conversation.` The thread id was not in the guest id format (`g-` plus hex). Corrected to `g-03e00001`.
- After the id fix, AC1 failed at the row read: `no such table: guest_thread_lane_events`.

Deviation from the red-first order: the Worker criterion (AC5, `apps/cloudflare/test/daily-export.spec.ts`, "3e AC5") was written after the implementation, not before. No red run was taken for it. It is green (see the verification entry).

Commit 1 of this issue holds the tests only. The tests import the new store exports, so `npm run check` fails on that commit until commit 2 (the implementation) lands. This is the expected red state.

### Implementing agent: verification and Definition of Done (steps 4 and 5)

Commit 2 of this issue holds the implementation. Commit 1 holds the tests (see the test-first record above). All commands run in `C:\AI2026\chat-marketplace-03e`, each prefixed `env -u LLM_API_KEY`.

**Commands and counts (final tree):**
1. `npm run check`: exit 0.
2. `npx tsx --test test/assistant-task-lanes.test.ts test/assistant-context-isolation.test.ts test/assistant-task-rail.test.ts test/assistant-task-persistence.test.ts test/assistant-thread-lock.test.ts test/assistant-cold-journey.test.ts test/agent-mode-shell.test.ts test/assistant-pack-contract.test.ts test/agent-mode-follows-task.test.ts test/assistant-persistent-continuity.test.ts test/assistant-pending-action-restore.test.ts test/assistant-lane-events.test.ts test/guest-thread-lane-events.test.ts`: tests 107, pass 106, fail 0, skipped 1 (the AC3 email part, OD-1).
3. Other tests that cover the changed store and projection code, one command each group, all green:
   - `npx tsx --test test/export-node-sqlite.test.ts test/guest-account-linking.test.ts test/demo-extended-cancellation-notice.test.ts test/guest-process-restart.test.ts test/sql-port-availability-interaction.test.ts test/sql-port-operator-stores.test.ts test/sql-port-store-imports.test.ts test/guest-account-sign-in.test.ts test/guest-offer-access.test.ts test/pilot-notifications.test.ts`: tests 201, pass 201.
   - `npx tsx --test test/assistant-budget-chip.test.ts test/assistant-discovery-view.test.ts test/assistant-open-question.test.ts test/assistant-runtime-boundary.test.ts test/assistant-terse-followups.test.ts test/integrate-booking-request-application.test.ts test/pay-each-demo-billing-period.test.ts`: tests 65, pass 65.
4. Worker specs, one per command with `npm run test:workers -- apps/cloudflare/test/<spec>.spec.ts`:
   - `daily-export.spec.ts` (includes the new "3e AC5" test): tests 10, pass 10.
   - `export-owner-sweep.spec.ts` (F9): tests 4, pass 4.
   - `restore-from-export.spec.ts`: tests 4, pass 4.
   - `data-migration.spec.ts` (platform migration 5 and the platform save path): tests 29, pass 29. The D2 5-second flake did not occur.
   - `platform-do-split.spec.ts`: tests 1, pass 1.
   - `legacy-single-do-migration.spec.ts`: tests 2, pass 2.
   - `platform-account-runtime.spec.ts`: tests 2, pass 2.
   - `production-composition.spec.ts`: tests 3, pass 3.
5. Not run, per Test scope: full `npm test` and full `npm run test:workers` (the once-per-batch gate).

**Definition of Done (`docs/agents/issue-tracker.md`):**
1. Every criterion has a dedicated named test: partly met. AC1, AC2, AC4, AC5, AC6 and AC7 each have one test named after the criterion. AC3 has one test for the phone and token form. Its email form is a skipped test, pending OD-1. AC3 is not met in full.
2. Failure paths asserted: met. AC2 asserts the rollback and the unchanged row for different content. AC6 asserts that refused roles are rejected by the parser and by the store, that no row is written, and that no thread is saved. AC7 is a scan.
3. ADRs listed and cited: met for the ADR table above, with the ADR 0093 reading stated as partial (its projection, email and redaction clauses).
4. No unused injected dependency: met. `saveThreadRecord` writes every field it is given. `laneEventSeq` is read on restore and written on every save. `STAYS_DOMAIN` names the stays lane's domain on a runtime-less thread.
5. No invented policy string or constant: met, with two notes. The 120-character and 32-entry bounds in the parsers are the bounds the existing task list and lane parsers already use (sourced to guest-projection.ts). The guest-visible copy is none: the lane rows hold timeline text only.
6. No bearer credential or identity material in logs or audit: met. The thrown messages are fixed strings with no ids. The table holds the redacted timeline text, thread and task ids, a domain, a sequence and a timestamp.
7. `npm run check`: exit 0. The batch-gate `npm test` has not run.

**Status.** Left at `ready-for-agent`, not `resolved`. Open:
- OD-1: the email part of AC3 (owner decision).
- The batch gate (`npm test` and the full `npm run test:workers`), once per batch, after this issue and the others in the batch are resolved.
- No direct Worker test of the platform object's `saveThread` route with a malformed `laneEvents` (the 400 branch). The criteria do not name it, and the route is covered by the parser test and by the store tests. The owner may want a route test added in the batch.
- The restore runbook line wording (owner review in the normal way).

**Implementation files (commit 2).** `domains/shortlet/src/guest-interaction-store.ts`, `apps/cloudflare/src/do-export.ts`, `apps/cloudflare/src/schema.ts`, `apps/cloudflare/src/platform-do.ts`, `apps/local-guest/src/guest-projection.ts`, `apps/local-guest/src/assistant/assistant-runtime.ts`, `apps/local-guest/src/shortlet-app.ts`, `docs/runbooks/cloudflare-restore.md`, this issue file. No `apps/local-guest/dist/*.js`, `_headers`, screenshots or CSS were touched. No formatter was run.
