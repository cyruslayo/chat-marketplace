# Assistant: take the guest's checkout and derive the nights on the server

Status: needs-triage
Type: AFK
Blocked by: 02
Requested: 1 Nov 2026

## Parent

[PRD](../PRD.md)

## Why

The deterministic path reads "20 Nov to 23 Nov" as a check-in and a checkout (`concierge.ts`, `given: true`). On the assistant path `search_stays` has no checkout argument (`shortlet-assistant-pack.ts:58-79`); the model must count the nights itself, and the classifier's `checkOut` slot is only used to reject (`date-tokens.ts currentTurnDateRoles`, `shortlet-assistant-pack.ts:349,375`). Nothing checks the model's nights against the guest's checkout.

## What to build

- `search_stays` accepts an optional `checkOut` (ISO or literal the guest wrote, same authority as `checkIn`) or `checkOutPhrase` (resolved as in issue 04).
- When the guest gave a checkout, the server derives nights from it; a model `nights` that disagrees is a `tool_denial` with the dates clarification.
- The derived stay is validated by `StayDateRange` (ADR 0023, 0092, 0055).

## Acceptance criteria

- [ ] AC1: "Ikoyi 20 Nov to 23 Nov for 2" searches 2026-11-20 to 2026-11-23 (3 nights) with no nights from the model.
- [ ] AC2 failure path: a model `nights` that contradicts the guest's checkout is a `tool_denial` and runs no search.
- [ ] AC3 failure path: a checkout before or equal to the check-in, or beyond the stay limits, is a `tool_denial` with the existing limit copy.
- [ ] AC4: Same input gives the same filters on the deterministic path and the assistant path (parity test).
- [ ] AC5: Runs with the assistant enabled and a cold restore before every event.

## ADR compliance

| ADR | Constraint | Affected |
|---|---|---|
| 0106 | Date authority; rejected calls are `tool_denial` | AC2, AC3 |
| 0023, 0092, 0055 | Stay length and horizon | AC3 |
| 0080 | Parity | AC4 |

## Comments
