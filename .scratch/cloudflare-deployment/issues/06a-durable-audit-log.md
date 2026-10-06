# Durable, typed, redacted audit log

Status: claimed
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
