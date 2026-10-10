# Persist money and audit records

Status: ready-for-agent
Type: task
Blocked by: none

## What to build

The production back office uses `InMemoryRevenueAccountingRepository`, `InMemoryBookingStateRepository`, `InMemoryAuditLog` and `InMemoryTelemetry` (`apps/local-owner/src/local-owner-environment.ts`, `apps/local-guest/src/fixture.ts`). Restarts lose them. Back them with SQLite in the same database, following the existing `Sqlite*Store` patterns. No bearer credential or restricted identity material in audit records (ADR 0075).

## Acceptance criteria

- [ ] Revenue accounting records survive a restart.
- [ ] Booking state records survive a restart.
- [ ] Audit records survive a restart.
- [ ] Telemetry survives a restart.
