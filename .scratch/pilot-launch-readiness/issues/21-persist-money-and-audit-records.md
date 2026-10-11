# Persist money and audit records

Status: resolved
Type: task
Blocked by: none

## What to build

The production back office uses `InMemoryRevenueAccountingRepository`, `InMemoryBookingStateRepository`, `InMemoryAuditLog` and `InMemoryTelemetry` (`apps/local-owner/src/local-owner-environment.ts`, `apps/local-guest/src/fixture.ts`). Restarts lose them. Back them with SQLite in the same database, following the existing `Sqlite*Store` patterns. No bearer credential or restricted identity material in audit records (ADR 0075).

## Acceptance criteria

- [ ] Revenue accounting records survive a restart.
- [ ] Booking state records survive a restart.
- [ ] Audit records survive a restart.
- [ ] Telemetry survives a restart.

## Comments
- 11 Oct 2026, **Status reconciliation**: `Status: ready-for-agent` -> `Status: resolved` (reconciled against origin/main 37b9c62).
  - Evidence: The four stores are wired in apps/local-owner/src/local-owner-environment.ts: `SqliteBookingStateRepository` (:595), `SqliteAuditLog` (:605), `SqliteTelemetry` (:606), `SqliteRevenueAccountingRepository` (:655). A grep finds no `InMemory*` store in that file or in apps/local-guest/src/fixture.ts. Restart tests: test/reserve-payout-restart.test.ts (reconciliation reports 6/6; `:68` reserve tranches survive a restart, `:117` no credential or contact material, ADR 0075), test/sqlite-audit-log.test.ts (5/5; `:12` entries survive a restart, `:33` no bearer token, cookie, access code or phone number, ADR 0075), test/sqlite-telemetry.test.ts (4/4; `:17` events survive a restart, `:69` no raw token, cookie or phone number), test/back-office-reservation.test.ts:133 (a restarted server still shows the booking state). Landing: revenue 502fcc1 (6 Oct 2026, ADRs 0078, 0089, 0095); audit 5303c68 (6 Oct 2026); telemetry cee7988 (6 Oct 2026); reserve payouts 3041cb4 (06e, 6 Oct 2026); booking state a403ee5 (5 Sep 2026, the earliest commit that adds SqliteBookingStateRepository).
  - Gaps: The reserve-payout restart tests are the closest evidence for the revenue criterion, not a test named for it. The mapping was not re-run here. The issue has no ADR table and no Answer section.
  - Not verified: `npm run check` and `npm test` were not re-run in this reconciliation, and the Definition of Done was not ticked item by item. The acceptance criteria boxes in this file are still unticked; the Definition of Done items were not re-verified.
