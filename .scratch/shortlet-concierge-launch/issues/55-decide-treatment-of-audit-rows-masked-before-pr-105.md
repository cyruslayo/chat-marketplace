# Decide what to do with audit and telemetry rows masked before PR #105

Status: ready-for-human
Type: HITL
Requested: 11 Oct 2026

## Parent

[Concierge Platform and Verified Shortlet Launch PRD](../PRD.md)

## Why

Before PR #105 (merged as `8b23923`, the current `origin/main`), the card-number rule masked some platform ids in audit and telemetry writes. Those rows were written masked and cannot be restored from the audit tables alone.

- Issue 50 measured the pre-fix rate as about 0.13% of `req-${randomUUID()}` ids being card-shaped and altered (for example `req-[REDACTED]-...`). The same rule altered `offer-`, `cmd-` and other prefixed ids written to `audit_log` (`packages/platform-core/src/sqlite-audit-log.ts`) and `telemetry_events` (`packages/platform-core/src/sqlite-telemetry.ts`).
- The detection query is `platformIdMaskedRowsSql` in `test/helpers/platform-id-fixtures.ts:137`, tested by `test/redact-platform-ids-detection.test.ts`. It matches flat, exact-case, top-level keys only (issue 50, Q4), so it under-counts nested or differently cased keys.
- Partial reconstruction may be possible from domain tables that still hold the same ids (for example `booking_requests` by `requestId`). This is not verified: no reconstruction has been run, and the domain-table mapping has not been checked.
- Production runs on Node and nothing deploys from `main` yet (as reported by the requester). Whether any production database holds such rows is not known from this repository.

## Question for the human

1. Does any production or pilot database exist that was written before PR #105 and holds `audit_log` or `telemetry_events` rows? If not, this issue can close as "no action".
2. If yes: back-fill (rebuild masked ids from domain tables), annotate the rows (add a flag that they are masked and by which rule), or leave them as they are?
3. Who may run a one-off detection query against that database, and where should the result be recorded (the detection SQL in issue 50 is the input)?

The status stays `ready-for-human` until question 1 is answered.

## Once decided (for the implementing agent)

- Run `platformIdMaskedRowsSql` against the database the human names (read-only; record counts only, never row contents, ADR 0075).
- If back-fill is chosen, write the reconstruction as a separate, reviewed migration with its own tests. If annotation is chosen, add a column or a marker, not an edit of the original row.

## ADR compliance

| ADR | Constraint | Affected path |
| --- | --- | --- |
| 0075 | Audit and telemetry are minimised; no personal or restricted data in logs | Any query output and any back-fill |
| 0004 | Backend owns authoritative state; audit rows are records of what happened | `audit_log`, `telemetry_events` (no silent rewrite) |

## Comments

- 11 Oct 2026, filed from issue 50 (Needs user, "Whether a migration or back-fill should run on production rows"; Why, PR #105 example and the measured rate). Source lines re-checked on `origin/main` 8b23923: `platformIdMaskedRowsSql` at `test/helpers/platform-id-fixtures.ts:137`.
- Not verified here: whether any reconstruction from domain tables is possible.
