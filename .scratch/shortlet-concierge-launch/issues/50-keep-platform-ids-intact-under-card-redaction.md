# Keep platform ids intact under the card-number redaction rule

Status: resolved
Type: AFK
Scope: outside the guest-accounts effort (ga-08-sign-in-offer). No guest-accounts files are touched.

## Parent

[Concierge Platform and Verified Shortlet Launch PRD](../PRD.md)

## Why

`packages/platform-core/src/redaction.ts` masks any 16-digit run, dashes and spaces included, with `[REDACTED]`. The rule ran on every string value, so platform-generated ids were masked too. Examples found by reproduction on `origin/main` (1dbd45b):

- `offer-17477973-5806-4004-bea8-8d50c54c0c30` becomes `offer-[REDACTED]-bea8-8d50c54c0c30`.
- `cmd-63bde504-acc8-40f0-9792-588939387591` becomes `cmd-63bde504-acc8-40f0-[REDACTED]`.

`InMemoryAuditLog.record` (`packages/platform-core/src/index.ts`) and `SqliteAuditLog.record` (`packages/platform-core/src/sqlite-audit-log.ts`) both redact the whole entry, including `requestId`, `commandEnvelopeId`, `offerId` and `aggregateId`. `SqliteTelemetry` (`packages/platform-core/src/sqlite-telemetry.ts`) does the same to telemetry payloads. About 0.136% of `req-${randomUUID()}` ids were altered (271 of 200,000 in the reproduction). Audit rows could therefore no longer be matched by request or command id. This is silent audit corruption in production.

The same cause made these tests flaky. In 200 runs on the unmodified code, `test/submit-and-resolve-timed-booking-request.test.ts` failed 5 times and `test/issue-and-accept-conditional-booking-offer.test.ts` failed 3 times. The failures were the masked ids (`cmd-[REDACTED]`, `offer-[REDACTED]`) and, at line 637, a `disclosureAudit` lookup by `requestId` that found no row.

## Decision (ADR 0075)

ADR 0075 requires one redactor for audit, telemetry and projections, so the fix stays in that redactor. The card-number rule is not weakened with lookarounds. Instead, a string is exempt from the string-pattern rules only when both hold:

1. It sits under a platform-id key listed in `PLATFORM_ID_PREFIXES_BY_KEY`.
2. It matches `<prefix>-<random v4 UUID>`, where the prefix is one listed for that key.

Sensitive keys are checked first and still win. Everything else is redacted exactly as before.

## Id keys and prefixes (derived from the code)

Keys come from a brace-matching scan of every `audit.record`, `telemetry.track` and `trackTransition` literal in `domains/`, `packages/` and `apps/`, plus the `TransitionTelemetryEvent` type. Prefixes come from the `<prefix>-${randomUUID()}` and `${idFactory()}` generator sites. The test `Every platform-id prefix in the exemption table is emitted by a platform id generator in the source` checks that every tabled prefix is a real generator.

| Key | Prefixes | Generator |
| --- | --- | --- |
| requestId | req | `domains/shortlet/src/booking-request.ts` |
| commandId, commandEnvelopeId | cmd | `packages/platform-core/src/envelope.ts` |
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

Keys such as `tenantId`, `unitId`, `actorId` and `reservationId` are not in the table. Their values are not `<prefix>-<uuid>` generator output, so they are unchanged.

## Reproduction

Red run, before the fix (13 tests in the first version of the file): 5 failed and 8 passed. The failures were the 20,000-id checks for `redactSensitiveData` and `SqliteAuditLog`, the known-bad-id `InMemoryAuditLog` test, the nested-object test, and the test that a card number next to a platform id keeps the id. The card-number, wrong-prefix, non-v4 and sensitive-key tests passed before and after, because they pin behaviour that must not change.

Flake loops (200 runs each, 4-way parallel, `npx tsx --test <file>`):

| File | Before (origin/main code) | After (this change) |
| --- | --- | --- |
| test/submit-and-resolve-timed-booking-request.test.ts | 5 of 200 failed | 0 of 200 failed |
| test/issue-and-accept-conditional-booking-offer.test.ts | 3 of 200 failed | 0 of 200 failed |

## Acceptance criteria

- [x] Platform-generated ids under their id keys pass through `redactSensitiveData` unchanged across 20,000 random ids (failure path: any altered id fails).
- [x] Known card-shaped platform ids are kept intact in `InMemoryAuditLog` entries, so they can be matched by `requestId` and `commandEnvelopeId`.
- [x] Platform-generated ids under their id keys are stored unchanged by `SqliteAuditLog` across 20,000 random ids.
- [x] Nested objects and arrays keep platform ids under their id keys unchanged.
- [x] Bare card numbers, card numbers with dashes or spaces, and card numbers in free text are still redacted (negative tests).
- [x] A card number under a platform-id key with a non-id-shaped value is still redacted.
- [x] A UUID-shaped value with a prefix that is not valid for its key, or with a non-v4 layout, is still redacted as before.
- [x] A card number next to a platform id is still redacted, and the platform id is kept.
- [x] A platform-id-shaped value under a key that is not a platform-id key is still redacted as before.
- [x] Sensitive keys are still redacted even when the value is a platform-generated id (`token`, `cardNumber`).
- [x] Every prefix in the exemption table is emitted by a generator in the source.
- [x] Existing redaction and audit tests pass unchanged (`test/prevent-interaction-security-failures.test.ts`, `test/sqlite-audit-log.test.ts`).

## Mutation probes

Each guard was removed in turn and `test/redact-platform-ids.test.ts` was run:

| Probe | Result |
| --- | --- |
| M1 key guard removed | fails (2 tests) |
| M2 prefix guard removed (any prefix under a listed key) | fails (1 test) |
| M3 shape check removed | fails (3 tests) |
| M4 v4 nibble removed | fails (1 test) |
| M5 overlap added (`token` in table), sensitive check kept first | survives, as intended: sensitive keys still win |
| M6 overlap added and sensitive precedence removed | fails (1 test) |
| M7 exemption removed | fails (5 tests) |

## Definition of Done (docs/agents/issue-tracker.md)

1. Every acceptance criterion has a dedicated named `test()` whose name mirrors it. Yes.
2. Failure paths are asserted: each negative case asserts the card or wrong-prefix output exactly. Yes.
3. ADRs read and cited: 0075 (primary), 0070, 0071, 0079, 0093, 0096. Listed in the PR body and in `## Comments`.
4. No injected dependency unused: no constructor parameters were added. Yes.
5. No policy string invented: the table is derived from generator and audit code, and the rule is technical, not a business policy. See the first open question below.
6. No bearer credential in audit records: sensitive keys still win, and the exemption covers only exact v4 shapes under the listed keys. Residual risk: see the open questions.
7. `npm run check` is clean. `npm run test:workers` (15 files, 87 tests) and `npm run test:non-browser` (1,679 tests in four chunks) pass locally. The browser phase is not run locally because Chrome is not installed here, so it is covered by the CI `browser` job on the final head.
8. Committed, then resolved.

## Are rows already written recoverable?

No, not from the audit or telemetry tables alone. `redactSensitiveData` ran before insert, so `audit_log.payload_json` and `telemetry_events.payload_json` hold only the masked text. The original digits are not stored there. A partial reconstruction may be possible from domain tables that still hold the same ids, by matching the unmasked fragments (for example `offer-%-bea8-8d50c54c0c30`). That is not verified, not automated and not part of this change. No migration is written.

Detection query (SQLite JSON1), to run against the production store:

```sql
SELECT id, recorded_at, payload_json FROM audit_log
WHERE json_extract(payload_json, '$.requestId') LIKE '%[REDACTED]%'
   OR json_extract(payload_json, '$.commandEnvelopeId') LIKE '%[REDACTED]%'
   OR json_extract(payload_json, '$.commandId') LIKE '%[REDACTED]%'
   OR json_extract(payload_json, '$.offerId') LIKE '%[REDACTED]%'
   OR json_extract(payload_json, '$.aggregateId') LIKE '%[REDACTED]%';
```

Repeat the same predicate for `telemetry_events`. Extend it to the other keys in the table above. The query finds rows only where a listed key was masked. It cannot find masked ids under keys that are not in the table.

## Needs user

- Residual risk: a 16-digit run written as an exact v4-shaped id under a listed key (for example `req-41111111-1111-4111-8111-111111111111`) is not masked. Only platform generators write these keys, so this needs a crafted input, but it is a deliberate trade-off against ADR 0075. Confirm that it is acceptable.
- Unprefixed `randomUUID()` values (for example the default `idFactory` in `browse.ts`) are not exempt, because the prefix set is closed. No audited key was found that holds one, but the scan is by key name and is not exhaustive.
- Non-UUID ids such as `res-${transactionRef}` (`packages/platform-core/src/reconciliation.ts`) can still be masked if they contain a digit run. They are out of scope and need their own decision.
- Whether a migration or back-fill job should run on production rows. Not written here, per the brief.

## Comments

- Red run (before the fix), flake loops and mutation probes are recorded above. The full ADR table is in the PR body.
- PR: https://github.com/cyruslayo/chat-marketplace/pull/105 (branch `fix-redaction-platform-ids`, code commit `e4f647b`).
- CI on `e4f647b`: `verify` (pull_request) run 38140324946 succeeded; `browser` (workflow_dispatch) run 38140325981 succeeded. Both are re-run on the final head after this status commit.
- Scope: this change is outside the guest-accounts effort (ga-08-sign-in-offer) and touches no guest-accounts files.
