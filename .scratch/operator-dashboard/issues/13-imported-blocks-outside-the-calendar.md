# Imported blocked dates are not in the Availability Calendar

Status: resolved
Type: follow-up
Blocked by: none
Found in: B8 (28 Sept 2026)

## Problem

ADR 0039 requires one central Availability Calendar and one effective availability result. Dates blocked through the inventory import do not reach it.

- `parseBlockedDates` in `domains/shortlet/src/inventory-import.ts` writes the `blocked_dates` column only into `Unit.blockedDates` in the inventory JSON. It creates no Operator Block in `availability_commitments`.
- Guest discovery (`browse.ts`, and the assistant's availability check in `apps/local-guest/src/assistant/assistant-runtime.ts`) filters on `Unit.blockedDates`. Imported ranges are therefore hidden from search.
- The authoritative checks read SQLite: Booking Request disclosure (`getAuthoritativeAvailability`) and the B8 back-office calendar. For imported ranges they report **Available**. A Guest with a direct link, or a stale surface, could request those dates. The back office also shows them as free.

B8 blocks write to both places. `addOperatorBlock` also updates the discovery projection, and `releaseOperatorBlock` removes the same range from it. The gap affects imported ranges only.

This matters before the pilot re-import (new owner-price and margin columns): any `blocked_dates` in that sheet will be half-applied.

## Decision (28 Sept 2026)

**Retire the column.** Blocks are entered only in the back-office calendar (B8), the single Availability Calendar that ADR 0039 asks for. Neither the template nor the rehearsal sheet uses `blocked_dates`, so nothing needs migrating.

Found while deciding: re-importing a Unit replaced it with the sheet row, including `blockedDates`. That wiped the discovery projection of blocks added in the back office. It is fixed here too, since the pilot re-import is next.

## Acceptance criteria

- AC1: A sheet without a `blocked_dates` column imports; the column is no longer required.
- AC2: A row with a value in `blocked_dates` is refused with an error saying to block dates in the back-office calendar, and nothing from that row is written.
- AC3: Re-importing a Unit keeps the blocks added in the back-office calendar, and an unchanged row still counts as unchanged.

## ADRs

| ADR | Constraint |
|---|---|
| 0039 | One central Availability Calendar; every channel updates it |
| 0072 | Idempotent commands |

## Answer

Delivered on `bo/b8a-retire-imported-blocks`, which is stacked on B8. The tests are the "Issue 13 AC1–AC3" tests in `test/inventory-import.test.ts`.

- **Import** (`domains/shortlet/src/inventory-import.ts`):
  - `blocked_dates` is no longer a required column.
  - A row with a value in it is refused with "blocked_dates is retired: block dates in the back-office calendar instead". This happens in dry runs too, and other rows still import.
  - The range parser is removed.
- **Re-import** keeps the Unit's existing `blockedDates`, the discovery projection of back-office blocks. An unchanged row therefore stays unchanged, and a changed row no longer wipes blocks.
- **Template and local pilot sheet** (`docs/pilot-inventory-template.csv`, `apps/pilot/src/local-pilot.ts`) drop the column.
- **Docs.** `docs/shortlet-pilot-inventory-operations.md` points to `/operator/calendar`.
- **Checks.** `npm run check` is clean, and the full `npm test` passed with 0 failures (1,116 and 123 tests).
