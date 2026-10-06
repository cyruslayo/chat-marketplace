# Inventory import route; CLIs over HTTPS

Status: ready-for-agent
Type: task
Blocked by: 11a
Branch: `infra/cf-11b-ops-import-cli`
Requested: 2 Oct 2026
Unlocks: 15

## Why

Inventory has to reach the Durable Object, and operators need the same CLI commands whether the target is local Node or Cloudflare.

## What to build

- `POST /_ops/inventory/import`, behind 11a's authentication. The request body is the CSV (`text/csv`). It runs `importInventoryCsv` (`domains/shortlet/src/inventory-import.ts:380`) against `SqliteUnitRepository` and returns its existing result summary as JSON. Enforce a body-size limit before reading: reuse the receipt limit's pattern, and **ask the user** for the value if there's no existing one to reuse.
- CLI switch: when `SHORTLET_OPS_URL` is set, the `pilot:operator:*`, `pilot:inventory:import`, `operator:provision` and `operator:revoke` scripts call the `/_ops` routes over HTTPS:
  - Access client ID and secret, plus the shared secret, come from env vars;
  - the CLIs refuse a non-`https:` URL unless the host is `localhost`.
  When it is unset, they behave exactly as today.
- Print a provisioned token **once** to stdout, as today. Never write it to a file or a log.
- Decide what happens to the `pilot:local:*` scripts: they stay Node-only. Document that in `docs/` next to the existing pilot docs.

## Out of scope

- The data migration import (16).

## Acceptance criteria

- AC1: Importing a CSV through the route gives the same units as `pilot:inventory:import` on Node for the same file.
- AC2: A malformed CSV is refused with the importer's existing errors, and no unit is written (the import is atomic). If the importer is not atomic today, record that and ask.
- AC3: With `SHORTLET_OPS_URL` set, each CLI command reaches its route, and an `http://` non-localhost URL is refused before any request is sent.
- AC4: With `SHORTLET_OPS_URL` unset, the CLIs and their tests behave the same as before.
- AC5: `npm run test:workers`, `npm test` and `npm run check` pass.

## ADR compliance

| ADR | Constraint | Code path |
| --- | --- | --- |
| 0008 / 0009 / 0056 | Imported units are subject to the inspection gate | importer unchanged |
| 0086 | Token printed once, never stored | CLI |

## Definition of Done

Check every item in `docs/agents/issue-tracker.md`.

## Comments
