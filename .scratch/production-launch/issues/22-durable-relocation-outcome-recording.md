# Record relocation outcomes durably

Status: ready-for-agent
Type: AFK
Blocked by: none
Requested: 8 Nov 2026 (owner decision on issue 09, 8 Nov 2026)

## Parent

[PRD](../PRD.md). Follow-up to [issue 09](09-pilot-metrics-for-operators.md): the pilot metrics report shows relocation outcomes as unavailable because no durable production record exists.

## Why

ADR 0028 and ADR 0029 define the Relocation Remedy and Refund Fallback with amounts. Today `apps/web/src/relocation-application.ts` defaults `cases` to `InMemoryRelocationRemedyRepository`, no production composition constructs `RelocationApplication`, and the legacy `RelocationManager` keeps its commits in a Map. A restart or cold restore loses every relocation outcome and amount, so operators cannot see them and the pilot metrics report cannot count them.

## What to build

- A durable `RelocationRemedyRepository` over the shared `SqlDatabase`, following the existing store pattern (schema DDL exported next to the class, added to `apps/cloudflare/src/schema.ts` migrations and the daily export/import allowlists).
- Wire `RelocationApplication` into the Node and Cloudflare compositions with the existing trusted providers and a durable booking-consequence port.
- Persist each case's choice, status, replacement unit/reservation reference, price difference, transport, refund total, operator liability, funding source/status and reconciliation state, with the version a command used (ADR 0072).
- Read the outcome in the pilot metrics report (issue 09) and show count and amounts instead of "unavailable".

## Acceptance criteria

- [ ] A committed Relocation Remedy or Refund Fallback survives a cold restore (new composition over the same store), with its amounts unchanged.
- [ ] The pilot metrics report counts relocations and refund fallbacks with their amounts from the durable record.
- [ ] No guest contact, card detail or payment reference appears in the metrics page or its logs (ADR 0075, 0096).
- [ ] The store's table is created by the Cloudflare schema migrations and appears on the import/export and daily-export lists.

## ADRs to read

0027, 0028, 0029, 0045, 0075, 0096. Issue 09's "Pilot metrics" definitions in `domains/shortlet/CONTEXT.md` stay authoritative for the metric names.
