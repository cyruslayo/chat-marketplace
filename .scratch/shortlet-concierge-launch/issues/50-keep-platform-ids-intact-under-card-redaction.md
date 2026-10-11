# Keep platform ids intact under the card-number redaction rule

Status: ready-for-human
Type: AFK
Blocked by: none
Scope: outside the guest-accounts effort (ga-08-sign-in-offer). No guest-accounts files are touched.

## Parent

[Concierge Platform and Verified Shortlet Launch PRD](../PRD.md)

## Why

`packages/platform-core/src/redaction.ts` masks any 16-digit run, dashes and spaces included, with `[REDACTED]`. The rule ran on every string value, so platform-generated ids were masked too. Examples found by reproduction on `origin/main` (1dbd45b):

- `offer-17477973-5806-4004-bea8-8d50c54c0c30` becomes `offer-[REDACTED]-bea8-8d50c54c0c30`.
- `cmd-63bde504-acc8-40f0-9792-588939387591` becomes `cmd-63bde504-acc8-40f0-[REDACTED]`.

`InMemoryAuditLog.record` (`packages/platform-core/src/index.ts`) and `SqliteAuditLog.record` (`packages/platform-core/src/sqlite-audit-log.ts`) both redact the whole entry, including `requestId`, `commandEnvelopeId`, `offerId` and `aggregateId`. `SqliteTelemetry` (`packages/platform-core/src/sqlite-telemetry.ts`) does the same to telemetry payloads. About 0.13% of `req-${randomUUID()}` ids were altered. Audit rows could therefore no longer be matched by request, command or offer id. This is silent audit corruption in production.

The same cause made these tests flaky. The failures were masked ids (`cmd-[REDACTED]`, `offer-[REDACTED]`) and audit lookups by those ids: `test/submit-and-resolve-timed-booking-request.test.ts` line 637 (`disclosureAudit` by `requestId`) and `test/issue-and-accept-conditional-booking-offer.test.ts` line 451 (`auditWeb` by `offerId`).

## What to build

Exempt a string value from the string-pattern redaction rules only when all of these hold:

1. It sits under a key listed in `PLATFORM_ID_PREFIXES_BY_KEY`, and it is not a sensitive key (sensitive keys are checked first and always win).
2. It matches `<prefix>-<random v4 UUID>`, where the prefix is listed for that key.
3. It contains no Luhn-valid 16-digit card-shaped run (Luhn gate, below).

Anything else is redacted as before. The card-number rule is not weakened, and the redactor stays the single one for audit, telemetry and projections (ADR 0075).

## Decision (ADR 0075)

ADR 0075 requires one redactor for audit, telemetry and projections, so the fix stays in that redactor. The card-number rule is not weakened with lookarounds.

## Id keys and prefixes (derived from the code)

Keys come from a brace-matching scan of every `audit.record`, `telemetry.track` and `trackTransition` literal in `domains/`, `packages/` and `apps/`, plus the `TransitionTelemetryEvent` type. Prefixes come from the `<prefix>-${randomUUID()}` and `${idFactory()}` generator sites. Test `test/redact-platform-ids-generators.test.ts` checks the key-to-prefix pairing against the generator call sites (assignment target and prefix), and checks that every audited key that receives a prefixed generator is either tabled for that prefix or listed in `PLATFORM_ID_CONSCIOUSLY_EXCLUDED` with a reason.

| Key | Prefixes | Generator |
| --- | --- | --- |
| requestId | req | `domains/shortlet/src/booking-request.ts` |
| commandId, commandEnvelopeId | cmd | `packages/platform-core/src/envelope.ts` (`commandEnvelopeId` is an alias, `ID_KEY_GENERATOR_ALIASES`) |
| offerId | offer | `domains/shortlet/src/conditional-offer.ts` |
| draftId | draft | `domains/shortlet/src/booking-request.ts` |
| threadId | thread | `packages/platform-core/src/thread.ts` |
| runId | run, turn | `packages/platform-core/src/thread.ts`, `domains/shortlet/src/same-day-turnover.ts` |
| surfaceId | surf | `packages/platform-core/src/surface.ts` |
| actionId | pa | `apps/local-guest/src/assistant/assistant-tools.ts` |
| quoteId | quote | `domains/shortlet/src/quote.ts` (`idFactory`) |
| queryId | search | `domains/shortlet/src/browse.ts` (`idFactory`) |
| commitmentId | blk, oph, brb | `domains/shortlet/src/availability.ts` |
| payoutId | payout | `domains/shortlet/src/owner-payable.ts` |
| recoveryId | recovery | `domains/shortlet/src/owner-payable.ts` |
| refundId | guest-refund | `domains/shortlet/src/owner-payable.ts` |
| aggregateId | union of all the above | derived in code |

Consciously excluded (`PLATFORM_ID_CONSCIOUSLY_EXCLUDED`):

| Key | Prefix | Reason |
| --- | --- | --- |
| threadId | g | Guest thread ids are chosen by the client (`THREAD_ID_PATTERN`, `apps/local-guest/src/guest-server.ts:578`). Exempting them would let a client carry a card number under an exempt key. Follow-up below. |
| sessionId | gs | Credential-like guest session id. Stays masked (orchestrator decision). |

Keys such as `tenantId`, `unitId`, `actorId` and `reservationId` are not in the table. Their values are not `<prefix>-<uuid>` generator output, so they are unchanged.

## Luhn gate (residual risk, decided by the orchestrator)

Without the gate, a Luhn-valid card number encoded as the digits of a v4 id (for example `req-55555555-5555-4444-8000-000000000000`) would pass unmasked under a listed key. The gate closes that. An otherwise exempt id is masked when any card-shaped run that the card rule matches is Luhn-valid.

- Only 16-digit runs are tested. The card rule masks only that shape, so the gate tests exactly what the rule would mask. Any id that falls through to the string rules is masked by that rule.
- 13 to 15 and 17 to 19 digit numbers are not gated, for the same reason: the existing rule does not match them, so they are not masked anywhere today. A 15-digit Amex-length number therefore stays unchanged in ids and in free text (pinned by a test). This is a pre-existing gap for the human to decide.
- Measured over 1,000,000 random v4 ids: 0.1256% have a card-shaped run; the gate masks 10.0% of those, which is 126 ids or about 1 in 7,937 platform ids. That is the residual loss in correlation.
- The orchestrator has accepted this residual. The human must confirm it.

## Follow-ups (recorded, not done)

- Guest thread ids `g-<uuid>` (`apps/local-guest/src/guest-server.ts:9136,9188`, `apps/local-guest/src/client.ts:183,2454`) are still masked in human-handoff audit rows (`packages/platform-core/src/human-handoff.ts:38-49`). Constrain `THREAD_ID_PATTERN` (`guest-server.ts:578`) on the server first, then exempt `g` under `threadId`. Test `Guest thread ids (g-<uuid>) are not exempt under threadId` pins the current behaviour.
- `providerReference` is audited (`provider-contracts.ts`) but is not in `sensitiveKeys`. This is pre-existing and separate.
- `res-${transactionRef}` (`packages/platform-core/src/reconciliation.ts`) is out of scope (already recorded above under Needs user).

## Reproduction and evidence

Red run before the change (`origin/main` code plus the new test files, captured at `d18270e`): the 20,000-id checks, the nested test, the PAN-in-id tests, and the new generator and detection-query checks failed. The card-number, wrong-prefix, non-v4 and sensitive-key tests passed before and after.

Flake loops (200 runs each, 4-way parallel, `npx tsx --test <file>`):

| File | Before (origin/main `redaction.ts`) | After (final code) |
| --- | --- | --- |
| test/submit-and-resolve-timed-booking-request.test.ts | 1 of 200 failed (run 194: `booking_request.expired` lookup) | 0 of 200 failed |
| test/issue-and-accept-conditional-booking-offer.test.ts | 1 of 200 failed (run 76: `auditWeb` lookup by `offerId`) | 0 of 200 failed |

Earlier campaign on the first version of this fix: before 5/200 and 3/200; after 0/200 and 0/200. The failure rate is roughly 1 in 750 to 1,000 runs, so 200 runs can show zero or one failures. Residual failures of about 1 in 3,000 runs are expected after the fix: the Luhn gate masks about 1 in 7,937 platform ids, and a file's failure needs one of its ids to be affected.

## Test files and counts

- `test/redact-platform-ids.test.ts`: 20 tests (20,000-id checks, PAN-in-id masking, non-Luhn ids unchanged, end anchor, trailing newline, guest thread ids not exempt, existing negative cases).
- `test/redact-platform-ids-precedence.test.ts`: 3 tests (sensitive key and tabled key in the same policy, via `createSensitiveDataRedactor`).
- `test/redact-platform-ids-generators.test.ts`: 4 tests (pairing, completeness, exclusions, generator closure).
- `test/redact-platform-ids-detection.test.ts`: 3 tests (detection query over both tables, clean rows, issue shows the generated query).
- `test/helpers/platform-id-fixtures.ts`: shared fixtures and oracles (not a test file).

## Mutation probes (final code)

Each probe applies one change to the worktree, runs the four files, and is restored after the run. Results are in the PR body and the report.

| Probe | Change | Expected |
| --- | --- | --- |
| M1 | key guard removed | fails |
| M2 | prefix guard removed | fails |
| M3 | shape check removed | fails |
| M4 | v4 nibble removed | fails |
| M5 | Luhn gate removed | fails |
| M6 | end anchor (`$`) removed | fails |
| M7 | exemption removed | fails |
| M8 | exemption checked before `sensitiveKeys` | precedence test fails |
| M9 | `token` added to the production table | generator pairing fails; precedence still holds |
| M10 | generator prefix changed (`quote` to `quotes`) | generator tests fail |
| M11 | exclusion key renamed (`sessionId`) | completeness fails |
| M12 | detection query drops `threadId` | detection test fails |
| M13 | `g` added to `threadId` | guest thread test and pairing fail |

## Definition of Done (docs/agents/issue-tracker.md)

1. Every acceptance criterion has a named test. Yes (see the test files above).
2. Failure paths are asserted with exact expected output. Yes.
3. ADRs read and cited: 0075 (primary), 0070, 0071, 0079, 0093, 0096. Listed in the PR body.
4. No injected dependency unused: no constructor parameters were added. The seam is a factory with a policy argument, used by production and by the precedence test.
5. No policy string invented: the table is derived from generator and audit code. The Luhn gate is a technical rule that the human must confirm (see Needs user).
6. No bearer credential in audit records: sensitive keys still win. The exemption covers only exact v4 shapes under the listed keys, with no Luhn-valid card run.
7. `npm run check` is clean. `npm run test:workers` and `npm run test:non-browser` pass locally. The browser phase is covered by the CI `browser` job on the final head (see the PR body for run URLs).
8. Committed and pushed. Status stays `ready-for-human` until the human accepts the Luhn residual.

## Are rows already written recoverable?

No, not from the audit or telemetry tables alone. `redactSensitiveData` ran before insert, so `audit_log.payload_json` and `telemetry_events.payload_json` hold only the masked text. The original digits are not stored there. A partial reconstruction may be possible from domain tables that still hold the same ids, by matching the unmasked fragments (for example `offer-%-bea8-8d50c54c0c30`). That is not verified, not automated and not part of this change. No migration is written.

Detection query (SQLite JSON1), generated from `PLATFORM_ID_PREFIXES_BY_KEY` by `platformIdMaskedRowsSql` in `test/helpers/platform-id-fixtures.ts`. Tested against a throwaway SQLite database with legacy masked rows for every key, including `threadId` guest ids (`test/redact-platform-ids-detection.test.ts`):

For `audit_log`:

```sql
SELECT id, recorded_at FROM audit_log
WHERE json_extract(payload_json, '$.requestId') LIKE '%[REDACTED]%'
   OR json_extract(payload_json, '$.commandId') LIKE '%[REDACTED]%'
   OR json_extract(payload_json, '$.commandEnvelopeId') LIKE '%[REDACTED]%'
   OR json_extract(payload_json, '$.offerId') LIKE '%[REDACTED]%'
   OR json_extract(payload_json, '$.draftId') LIKE '%[REDACTED]%'
   OR json_extract(payload_json, '$.threadId') LIKE '%[REDACTED]%'
   OR json_extract(payload_json, '$.runId') LIKE '%[REDACTED]%'
   OR json_extract(payload_json, '$.surfaceId') LIKE '%[REDACTED]%'
   OR json_extract(payload_json, '$.actionId') LIKE '%[REDACTED]%'
   OR json_extract(payload_json, '$.quoteId') LIKE '%[REDACTED]%'
   OR json_extract(payload_json, '$.queryId') LIKE '%[REDACTED]%'
   OR json_extract(payload_json, '$.commitmentId') LIKE '%[REDACTED]%'
   OR json_extract(payload_json, '$.payoutId') LIKE '%[REDACTED]%'
   OR json_extract(payload_json, '$.recoveryId') LIKE '%[REDACTED]%'
   OR json_extract(payload_json, '$.refundId') LIKE '%[REDACTED]%'
   OR json_extract(payload_json, '$.aggregateId') LIKE '%[REDACTED]%'
ORDER BY id;
```

For `telemetry_events`:

```sql
SELECT id, recorded_at FROM telemetry_events
WHERE json_extract(payload_json, '$.requestId') LIKE '%[REDACTED]%'
   OR json_extract(payload_json, '$.commandId') LIKE '%[REDACTED]%'
   OR json_extract(payload_json, '$.commandEnvelopeId') LIKE '%[REDACTED]%'
   OR json_extract(payload_json, '$.offerId') LIKE '%[REDACTED]%'
   OR json_extract(payload_json, '$.draftId') LIKE '%[REDACTED]%'
   OR json_extract(payload_json, '$.threadId') LIKE '%[REDACTED]%'
   OR json_extract(payload_json, '$.runId') LIKE '%[REDACTED]%'
   OR json_extract(payload_json, '$.surfaceId') LIKE '%[REDACTED]%'
   OR json_extract(payload_json, '$.actionId') LIKE '%[REDACTED]%'
   OR json_extract(payload_json, '$.quoteId') LIKE '%[REDACTED]%'
   OR json_extract(payload_json, '$.queryId') LIKE '%[REDACTED]%'
   OR json_extract(payload_json, '$.commitmentId') LIKE '%[REDACTED]%'
   OR json_extract(payload_json, '$.payoutId') LIKE '%[REDACTED]%'
   OR json_extract(payload_json, '$.recoveryId') LIKE '%[REDACTED]%'
   OR json_extract(payload_json, '$.refundId') LIKE '%[REDACTED]%'
   OR json_extract(payload_json, '$.aggregateId') LIKE '%[REDACTED]%'
ORDER BY id;
```

The query finds rows only where a listed key was masked. It cannot find masked ids under keys that are not in the table, nor masked guest session ids (`sessionId`), which were never exempt and are masked by design.

## Needs user

- Accept or reject the Luhn-gate residual: about 1 in 7,937 platform ids (measured) now lose correlation, because a Luhn-valid 16-digit card number can be encoded in them. The orchestrator has accepted this, and the human must confirm it. Status stays `ready-for-human` until then.
- Pre-existing gap: 13 to 15 and 17 to 19 digit card numbers are not matched by the card rule anywhere (free text included). A 15-digit Amex-length number is therefore not masked. Decide whether the rule should cover them.
- Unprefixed `randomUUID()` values (for example the default `idFactory` in `browse.ts` for other uses) are not exempt, because the prefix set is closed. No audited key was found that holds one, but the scan is by key name and is not exhaustive.
- Non-UUID ids such as `res-${transactionRef}` (`packages/platform-core/src/reconciliation.ts`) can still be masked if they contain a digit run. Out of scope.
- Whether a migration or back-fill job should run on production rows. Not written here, per the brief.

## Comments

- CI run links for this change are in the PR body (https://github.com/cyruslayo/chat-marketplace/pull/105), including the dispatched `browser` run on the final head.
- Scope: this change is outside the guest-accounts effort (ga-08-sign-in-offer) and touches no guest-accounts files.
