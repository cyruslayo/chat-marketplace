# Durable, redacted telemetry

Status: resolved
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

### Verification and Definition of Done

1. Four dedicated `06b AC1`–`AC4` tests in `test/sqlite-telemetry.test.ts`; the initial run failed on the missing implementation (`C:/AI2026/cf-06b-red.log`).
2. AC1 restarts both real environments; AC2 retries one transition before/after a file-backed reopen and verifies one row and one sink call, while distinct keys and ordinary events remain distinct. Outer rollback does not poison durable dedupe. AC3 inspects every raw table column and the sink for nested synthetic token/cookie/phone values, including a sensitive transition key.
3. Re-checked the ADR table: shared durable evidence implements 0004/0095/0079, correlation survives, and the shared redactor precedes both table/sink under 0070/0071/0075. The unique indexed key is a SHA-256 digest of the raw dedupe identity, not raw credentials; distinct identities are not collapsed by masking.
4. Both constructor dependencies are used: SQL for schema/read/write, optional sink after an actual insert. Handles remain borrowed; no new connection/pragmas/close ownership.
5. No events, policy, thresholds, retention or Workers Logs configuration invented.
6. Table/sink credential absence is tested. In-memory telemetry uses the same redactor, and returned snapshots are detached from its history.
7. `npm run check`, **87 focused tests**, **14 workerd tests**, whitespace checks and full `npm test` pass. Full suite exits 0: **1,290 non-browser and 165 browser passes, zero failures, one expected skip**. Node tests unset the previously documented `PI_REASONING_LEVEL`. Evidence: `C:/AI2026/cf-06b-{check,focused,workers,full}.log`; `cf-06b-full.exit` = 0. LSP did not confirm clean coverage; successful compiler checks are the typecheck evidence.

The optional synchronous observational sink follows an insertion, not an enclosing transaction's eventual commit, and is not an outbox or a guaranteed-delivery channel. No sink is wired in either environment. When 10b wires external logs, do not treat that stream as committed domain state: use the durable table as authority and forward outside material transaction boundaries (or introduce a separately scoped commit-aware outbox if that guarantee is needed). A failed sink does not undo the durable insert.

## Answer

Implementation `cee7988` on `infra/cf-06b-telemetry`: typed telemetry port, redacted shared-handle event table, unique hashed transition index and optional redacted sink. Guest/owner events and transition dedupe survive restart. All gates passed before resolution; no Workers Logs deployment/configuration or Wave 3 work.
