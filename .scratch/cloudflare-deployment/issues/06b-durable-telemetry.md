# Durable, redacted telemetry

Status: claimed
Type: task
Blocked by: 02a
Branch: `infra/cf-06b-telemetry`
Requested: 2 Oct 2026
Unlocks: 06d

## Why

`InMemoryTelemetry` (`packages/platform-core/src/index.ts:19`) holds events, and the `#transitionKeys` dedupe set, in memory. After a restart:
- every event is gone;
- `trackTransition` would record the same transition again, which breaks ADR 0079's "no duplicate side effects".

## What to build

- A `Telemetry` interface (`track`, `trackTransition`, `events`) that `InMemoryTelemetry` implements.
- `SqliteTelemetry` takes a `SqlDatabase`. It writes events to a `telemetry_events` table and enforces transition dedupe with a **unique index on `transition_key`**, using `INSERT OR IGNORE`, so the dedupe is durable.
- Redact events with the same shared redaction function as 06a.
- Add an optional `sink: (event) => void` for forwarding to Workers Logs, which slice 10b wires to `console.log` with JSON. The sink receives the **redacted** event only. Default: no sink.
- Both environments use `SqliteTelemetry` on their shared handle.

## Out of scope

- Workers Logs configuration (13).
- Changing which events are emitted.

## Acceptance criteria

- AC1: Events survive a restart.
- AC2: A transition tracked before a restart is not recorded again after it. Failure path: calling `trackTransition` twice with the same key across a restart leaves one row.
- AC3: Neither the table nor the sink ever receives a raw token, cookie or phone number (ADR 0075).
- AC4: `npm test` and `npm run check` pass.

## ADR compliance

| ADR | Constraint | Code path |
| --- | --- | --- |
| 0079 | Replayable, no duplicate side effects | durable unique `transition_key` |
| 0075 | Redaction | before insert and before the sink |

## Definition of Done

Check every item in `docs/agents/issue-tracker.md`.

## Comments

### Direct continuation plan (6 Oct 2026)

This slice builds on 06a's committed shared pure redactor (`5303c68`), without modifying its stable full-suite snapshot. Integration/resolution waits for validation. Add a typed telemetry port, shared-handle table and unique transition index; use the redactor for both table and optional sink. Keep event vocabulary unchanged. Dedicated AC tests run red first.

| ADR read | Constraint | Acceptance/code path |
| --- | --- | --- |
| 0004 / 0095 | Shared authoritative backend SQL, synchronous writes | AC1 / AC2, composition and insert |
| 0070 / 0071 | Retain correlation IDs, exclude credentials and restricted projection material | AC3, redaction |
| 0075 | Redact before table and sink; no retention policy invented | AC3 |
| 0079 | Durable evidence and no duplicated transitions | AC1 / AC2, unique transition key |

No Workers Logs wiring (10b/13), revenue rules (06c) or new events are introduced.
