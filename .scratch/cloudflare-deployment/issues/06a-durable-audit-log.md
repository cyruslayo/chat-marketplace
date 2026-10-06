# Durable, typed, redacted audit log

Status: resolved
Type: task
Blocked by: 02a
Branch: `infra/cf-06a-audit-log`
Requested: 2 Oct 2026
Unlocks: 06d

## Why

Both environments keep the audit trail in `InMemoryAuditLog` (`packages/platform-core/src/index.ts:7`; used at `fixture.ts:275` and `local-owner-environment.ts:435`). The log is lost on every restart, and it uses `any` (:8, :10, :14). On a Durable Object, eviction is a routine restart, so the audit trail would vanish regularly. This gap exists today on Node too.

## What to build

- Define an `AuditEntry` type and an `AuditLog` interface (`record(entry)`, `entries()`) in platform-core. Base the type on what callers actually record: grep `audit.record(` and type the union, or a common shape with an `unknown`-typed `details` field narrowed by callers.
- `InMemoryAuditLog` implements the interface with no `any`. It stays for tests.
- `SqliteAuditLog` (`packages/platform-core/src/sqlite-audit-log.ts`) takes a `SqlDatabase` and writes to an append-only `audit_log` table. It has no update or delete methods. Store an ISO `recorded_at` and a JSON payload.
- **Redact before writing** (ADR 0075). Reuse `InteractionSecurityEngine.redactSensitiveData` (`packages/platform-core/src/interaction-security.ts:213`). Don't write a second redactor. If that engine needs constructor inputs the log does not have, extract the pure redaction function into a shared module, and note it in `## Comments`.
- Both environments use `SqliteAuditLog` on their shared handle. Tests can keep the in-memory one.

## Out of scope

- Telemetry (06b) and the export of audit rows (12a).

## Acceptance criteria

- AC1: Audit entries written before a restart, through a new environment on the same database, are readable afterwards, in order.
- AC2: No bearer token, cookie, access code or phone number reaches the `audit_log` table. Failure path: recording an entry that contains each of these stores the redacted form, and a test asserts the raw value appears nowhere in the table (ADR 0075).
- AC3: The audit log exposes no way to modify or delete an entry, and no `any` remains in `index.ts`.
- AC4: Recording an audit entry inside a domain transaction that then rolls back leaves no entry. If the current callers record outside transactions, document that instead and test the actual behaviour.
- AC5: `npm test` and `npm run check` pass.

## ADR compliance

| ADR | Constraint | Code path |
| --- | --- | --- |
| 0075 | Redaction; no bearer credentials in logs | redaction before insert |
| 0070 | Server-bound identities | identities stored as bound IDs, never tokens |
| 0079 | Observable and durable | table on the shared handle |

## Definition of Done

Check every item in `docs/agents/issue-tracker.md`. Item 6 applies directly.

## Comments

### Direct continuation plan (6 Oct 2026)

Use the existing shared SQL handle in both environments; extract the engine's pure redactor rather than add a second implementation. Keep the in-memory test adapter and append-only API. Write dedicated AC tests red first, then run compiler, focused tests, Workers tests and the serialized full suite before resolution.

| ADR read | Constraint | Acceptance/code path |
| --- | --- | --- |
| 0004 / 0095 | Backend owns durable state; synchronous shared SQL transactions | AC1 / AC4, environment composition and insert |
| 0070 | Keep server-bound IDs distinct from credentials | AC2, preserve IDs but redact tokens |
| 0075 | Minimize logs, no secrets, restricted identity or access material | AC2, shared redactor before storage |
| 0079 | Durable ordered material-action evidence | AC1, ordered append-only rows |

No retention period or new domain policy is introduced. Telemetry remains 06b; revenue remains 06c.

### Verification and Definition of Done

1. Five dedicated `06a AC1`–`AC5` tests in `test/sqlite-audit-log.test.ts`; test file initially failed on the missing implementation (`C:/AI2026/cf-06a-red.log`), then all five passed.
2. AC2 records nested synthetic bearer credentials, cookies, access codes and phone numbers and inspects every raw table column; AC4 explicitly throws in outer/nested transactions and verifies absence of rolled-back rows. AC3 verifies both shallow and nested returned data cannot mutate history.
3. Re-read the ADR table: ordered shared-handle storage implements 0004/0095/0079, bound principal IDs survive redaction under 0070, and 0075 redaction happens before storage. No retention assumptions added.
4. The only new store dependency (`SqlDatabase`) is used for DDL/inserts/reads; connection ownership stays with the environments.
5. No policy values or new domain events invented.
6. Extracted the existing engine redactor into `redaction.ts`, added normalized cookie/access-code/phone and credential key coverage, and made the engine/in-memory audit/durable audit use that one implementation. No credentials logged. Existing caller inspection found card-payment audit PSP references, now masked centrally.
7. `npm run check` passes; 84 focused tests and 14 workerd tests pass; full `npm test` exits 0 with **1,286 non-browser and 165 browser passes, zero failures, one expected skip**. Full tests unset `PI_REASONING_LEVEL` for the known unrelated broad environment assertion. `git diff --check` passes. Logs: `C:/AI2026/cf-06a-{check,focused,workers,full}.log`; exit marker `cf-06a-full.exit` = 0.

The active LSP probe was not fully conclusive and surfaced generic auxiliary lint rules against `unknown` redaction and deliberate fail-closed JSON parsing; these are not TypeScript errors. The successful compiler checks supply the clean typecheck evidence. No errors are swallowed to hide corrupt audit rows.

Audit insertion participates in any outer shared SQL transaction; it does not create a transaction around an entire application command. Availability/booking/payment callers often audit after their store-specific transaction returns, so those independent writes remain independent. AC4 proves the actual shared-handle outer rollback behaviour; this slice does not claim a new atomic command boundary.

## Answer

Committed implementation `5303c68` on `infra/cf-06a-audit-log`: typed append-only audit port, durable ordered audit rows, shared redaction and guest/owner composition. Returned snapshots cannot mutate stored evidence. All acceptance and shared gates passed before resolution. No export, retention job, Workers deployment or Wave 3 work.
