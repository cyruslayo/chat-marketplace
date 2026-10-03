# Durable, redacted telemetry

Status: ready-for-agent
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
