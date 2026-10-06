# Daily export and orphan-receipt sweep alarm

Status: ready-for-agent
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
