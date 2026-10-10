# Inventory import route; CLIs over HTTPS

Status: resolved
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

## Answer

Resolved 7 Oct 2026 on `infra/cf-11b-ops-import-cli`.

### Route

`POST /_ops/inventory/import` in `apps/cloudflare/src/ops-routes.ts`, behind 11a's two authentication layers. Query parameters `tenantId` (defaults to the deployment tenant) and `dryRun=true`. The body is the CSV (`text/csv`) and the **user-confirmed 5 MiB limit is enforced before a single byte is read** via the existing `readBodyWithLimit`. It runs `importInventoryCsv` against `SqliteUnitRepository` with `operatorResolverFromRepository(SqliteOperatorRepository)` and returns the importer's own summary verbatim as JSON; the audit records the tenant and counts only.

### CLI remote mode

`apps/shortlet-ops/src/ops-client.ts` adds the switch: when `SHORTLET_OPS_URL` is set, `pilot:operator:create|list|update|bootstrap`, `pilot:inventory:import`, `operator:provision` and `operator:revoke` call the `/_ops` routes instead of touching local files/SQLite. Both layers are sent (`x-shortlet-ops-secret`, `cf-access-client-id`/`cf-access-client-secret`). `assertOpsUrlAllowed` refuses any non-`https:` URL before a request is made, allowing `http:` only for `localhost`/`127.0.0.1`. With `SHORTLET_OPS_URL` unset the tools take their original path unchanged. A provisioned token is printed once to stdout, never to a file or a log. The `pilot:local:*` commands stay Node-only, documented in `docs/pilot-deployment.md`.

### Acceptance evidence

- **AC1** (`apps/cloudflare/test/ops-inventory.spec.ts`): importing `docs/pilot-inventory-template.csv` through the route reports the same rows/valid/invalid counts on a dry run and **changes nothing**, then stores exactly the valid rows on the wet run, and creates the units.
- **AC2**: a row the importer rejects returns its existing per-row error (`CSV row has N columns; expected M`) with `invalid: 1` and writes nothing; a header it refuses returns `400` with the importer's own "missing required columns" message; a body over 5 MiB returns `413` before storage. All three leave the unit set unchanged.
- **AC3** (`test/ops-remote-cli.test.ts`): `http://ops.example.com` is refused before any request (both via `assertOpsUrlAllowed` and `remoteOpsConfiguration`), while `https:` and localhost `http:` are allowed; spawning the list CLI against a local server proves it sends both authentication headers and prints the routed result.
- **AC4**: `remoteOpsConfiguration({})` returns null, so the CLIs keep their local behaviour.
- **AC5**: `npm run check` clean; `npm run test:workers` passes **40** workerd tests; the Vite build emits 325 modules with no `node:sqlite`.

### Recorded finding — importer atomicity (needs the user's decision)

`importInventoryCsv` is **not all-or-nothing**: it validates row by row and stores the valid rows while reporting the invalid ones, and the CLI exits `1` when any row was invalid. A malformed *header* refuses the whole file (nothing is written), and an oversized body is refused before reading, but a single bad *row* in an otherwise valid file still commits the good rows. The route keeps this behaviour (no new logic). If row-level failures must instead roll back the whole import, that is a domain change and needs your decision — recorded here rather than guessed.

### Notes

- `operator:revoke mode=session` has no route (11a exposes per-operator access, not per-session revocation); remote mode supports `all` and says so. A single session is revoked from the back office.
- ADRs checked: 0008/0009/0056 (imported units keep the inspection gate; the importer is unchanged), 0086 (token printed once, never stored).
