# Daily export and orphan-receipt sweep alarm

Status: resolved
Type: task
Blocked by: 07b, 10b
Branch: `infra/cf-12a-export-alarm`
Requested: 2 Oct 2026
Unlocks: 15

## Why

Durable Object point-in-time recovery covers 30 days. A daily off-object export gives a second copy of the evidence tables. Receipt objects whose metadata row never committed (07a's put-then-row order) need sweeping.

## What to build

- Add a daily task to the 10b alarm's task list, without disturbing the notifier sweep:
  - **Export:** for the audit, booking, payment, owner-payable and payout tables, write one JSONL object per table per day to `EXPORTS`, keyed `YYYY-MM-DD/<table>.jsonl`, with the date in Africa/Lagos per ADR 0078. Read in pages so no single query or object breaks Durable Object limits. Find the exact table names from the stores; don't guess them.
  - **Export redaction:** the audit log is already redacted (06a). Other tables export as stored. Note any column that holds personal data in `## Comments`, for the DPIA (14).
  - **Retention:** delete exports older than the retention period. ADR 0075 retention is **provisional**, so **ask the user** for the value and make it configurable. Don't invent one.
  - **Orphan sweep:** list `RECEIPTS` objects older than 24 hours with no matching `manual_transfer_receipts.object_key`, and delete them. **Ask the user** whether a different grace period applies.
- The task must be idempotent: running it twice on the same day overwrites the same objects.

## Out of scope

- The restore runbook (12b).

## Acceptance criteria

- AC1: After the alarm runs, `EXPORTS` holds one JSONL object per listed table for the day, with row counts equal to the table counts.
- AC2: Running the export twice on the same day leaves one object per table, not two.
- AC3: An R2 receipt with no metadata row, older than the grace period, is deleted. Failure path: a receipt **with** a row, or a newer orphan, is kept.
- AC4: Exports older than the configured retention are deleted, and newer ones are kept.
- AC5: A failing export does not stop the notifier sweep, and the alarm reschedules. `npm run test:workers` and `npm run check` pass.

## ADR compliance

| ADR | Constraint | Code path |
| --- | --- | --- |
| 0075 | Retention periods (provisional) | configurable retention |
| 0079 | Observable and replayable | the export is the replay source |
| 0090 | Receipts are evidence | only orphans are swept |

## Definition of Done

Check every item in `docs/agents/issue-tracker.md`.

## Comments

## Answer

Resolved 7 Oct 2026 on `infra/cf-12a-export-alarm`.

### Export

`apps/cloudflare/src/do-export.ts` writes one JSONL object per table per day to `EXPORTS`, keyed `YYYY-MM-DD/<table>.jsonl` with the date in **Africa/Lagos** (ADR 0078, `lagosDate`). The 18 table names come from the stores themselves, not invented: `audit_log`; `booking_contracts`, `booking_reservations`; `guest_booking_requests`, `guest_conditional_offers`, `guest_booking_snapshots`; `booking_payment_journeys`, `guest_checkout_sessions`, `guest_live_payment_attempts`, `guest_processed_psp_references`; `bank_transfer_sessions`, `manual_transfers`, `manual_transfer_receipts`; `owner_payable_cancellations`, `owner_payouts`, `guest_refunds`, `owner_payout_recoveries`; `reserve_payout_records`. Reads are paged (500 rows) so no single query or object approaches the Durable Object limits, and the task is idempotent — the same day writes the same keys again. `manual_transfer_receipts` exports its metadata only (`receipt_id, transfer_id, content_type, object_key, size_bytes`): the bytes live in R2 (ADR 0090) and a legacy BLOB row must not be inlined. A table absent in a deployment still gets its (empty) object so each day's set is uniform for a restore.

### Retention and orphan sweep (user-approved values)

- `SHORTLET_EXPORT_RETENTION_DAYS` (default **400**) deletes export objects whose date is older than the cutoff, and never the current day.
- `SHORTLET_RECEIPT_ORPHAN_GRACE_HOURS` (default **24**) deletes `RECEIPTS` objects older than the grace period that have no matching `manual_transfer_receipts.object_key`. It **fails closed** — if the metadata table does not exist it deletes nothing.

### Alarm wiring

The `daily-export` task is appended to the alarm's task list (`shortlet-pilot-do.ts`), independent of the guest runtime so it runs whether or not the tenant is provisioned. It is gated to once per Lagos day by `storage["export:lastDate"]`, and the alarm now **always reschedules** — 24 hours when no runtime is built, otherwise the notification sweep interval.

### Acceptance evidence (`apps/cloudflare/test/daily-export.spec.ts`)

- **AC1**: after `alarm()`, `EXPORTS` holds one object per listed table for the day; the `audit_log` object has the seeded row count and the entry payload, and the alarm is rescheduled.
- **AC2**: running the export twice produces byte-identical objects (overwrite, not append).
- **AC3**: with a 24 h grace a fresh orphan is kept; with no grace an old orphan with no metadata row is deleted while one **with** a row is kept.
- **AC4**: a `2020-01-01` export is deleted at 400-day retention while a future one is kept.
- **AC5**: `runAlarmTasks` isolates a throwing `daily-export` task; the `notifications` task still runs (the alarm reschedules regardless).
- **AC6 (gate)**: `npm run check` clean; `npm run test:workers` passes **45** workerd tests; the Vite build emits 325 modules with no `node:sqlite`.

### For the DPIA (slice 14) — personal data in exported tables

The audit log is already redacted (06a). The other tables export as stored and several carry personal data in JSON/text columns: `guest_booking_requests`, `guest_conditional_offers`, `guest_checkout_sessions` and `guest_booking_snapshots` (guest names/contact fields in their JSON), `guest_contacts` is **not** exported, `manual_transfers`/`manual_transfer_receipts` (transfer references), `owner_payouts`/`guest_refunds`/`owner_payout_recoveries` (amounts and references). The `EXPORTS` bucket is private; the retention period is the provisional ADR 0075 value the user confirmed. Record these columns in the DPIA before real-data staging.
