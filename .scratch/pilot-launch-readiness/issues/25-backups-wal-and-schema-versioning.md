# Backups, WAL and schema versioning

Status: ready-for-agent
Type: task
Blocked by: 21

## What to build

Stores only run `CREATE TABLE IF NOT EXISTS`; there is no schema version, WAL is not enabled, and there is no backup tooling (the rehearsal `restore-check.ts` is stale).

## Acceptance criteria

- [ ] The database uses WAL.
- [ ] A `schema_version` record and ordered migrations run at startup; an unknown newer version fails startup.
- [ ] `npm run ops:backup` writes a consistent copy of the database and the inventory and operator files.
- [ ] A restore check proves a backup starts the pilot with the same Booking Requests and Reservations.
