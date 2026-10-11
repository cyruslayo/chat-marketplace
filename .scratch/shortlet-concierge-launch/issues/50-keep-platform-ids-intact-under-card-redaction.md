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

The same cause made these tests flaky: masked ids (`cmd-[REDACTED]`, `offer-[REDACTED]`) and audit lookups by those ids. `test/submit-and-resolve-timed-booking-request.test.ts` line 637 (`disclosureAudit` by `requestId`) and `test/issue-and-accept-conditional-booking-offer.test.ts` line 451 (`auditWeb` by `offerId`).

## What to build

A string under a key listed in `PLATFORM_ID_PREFIXES_BY_KEY` is handled in this order:

1. If the key is sensitive (`sensitiveKeys`), the value is `[REDACTED]`. Sensitive keys always win.
2. If the Luhn gate trips (a card-rule match that is Luhn-valid, or a whole 17 to 19 digit run that is Luhn-valid; see the Luhn gate section), the whole value is `[REDACTED]`. This is fail closed, whatever the value's shape.
3. If the value is exactly `<prefix>-<random v4 UUID>` with a prefix listed for that key, it is kept unchanged (exempt).
4. Otherwise the string rules apply as before.

Arrays under such a key are walked with the same rules, so an id in an array is treated like the same id in a scalar. Everything else is unchanged. The card-number rule is not weakened, and the redactor stays the single one for audit, telemetry and projections (ADR 0075).

## Decision (ADR 0075)

ADR 0075 requires one redactor for audit, telemetry and projections, so the fix stays in that redactor. The card-number rule is not weakened with lookarounds.

## Id keys and prefixes (derived from the code)

Keys come from a brace-matching scan of every `audit.record`, `telemetry.track` and `trackTransition` literal in `domains/`, `packages/` and `apps/`, plus the `TransitionTelemetryEvent` type. Prefixes come from the `<prefix>-${randomUUID()}` and `${idFactory()}` generator sites.

`test/redact-platform-ids-generators.test.ts` finds generator sites by text: TypeScript 7 exposes no JS compiler API and no parser is a dependency, so each `<prefix>-${randomUUID()}` (or idFactory) template is resolved to the name it is assigned to by a bracket-aware scan backwards. It handles `name =`, `name:`, ternary true and false branches, and `??`/`||`. A template inside call arguments has no resolved name (lhs null) and is not checked. The test checks the key-to-prefix pairing against those sites, and checks that every audited key receiving a prefixed generator is tabled for that prefix or listed in `PLATFORM_ID_CONSCIOUSLY_EXCLUDED`. Each exclusion names its key, the files that emit its prefix, and a reason.

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
| principalId | guest | `apps/local-guest/src/guest-server.ts` (ternary true branch, server-generated; see below) |
| aggregateId | union of all the above | derived in code |

Consciously excluded (`PLATFORM_ID_CONSCIOUSLY_EXCLUDED`):

| Key | Prefix | Files | Reason |
| --- | --- | --- | --- |
| threadId | g | `apps/local-guest/src/guest-server.ts`, `apps/local-guest/src/client.ts` | Guest thread ids are chosen by the client (`THREAD_ID_PATTERN`, `apps/local-guest/src/guest-server.ts:578`). Exempting them would let a client carry a card number under an exempt key. Follow-up below. |
| sessionId | gs | `apps/local-guest/src/guest-server.ts` | Credential-like guest session id. Stays masked (orchestrator decision). |

Keys such as `tenantId`, `unitId`, `actorId` and `reservationId` are not in the table. Their values are not `<prefix>-<uuid>` generator output, so they are unchanged.

### principalId (added in this round)

The site is `apps/local-guest/src/guest-server.ts` (the session-scoped principal): `const principalId = sessionScopedGuestPrincipals ? \`guest-${crypto.randomUUID()}\` : app.environment.config.guestId`. The `guest-<uuid>` branch is server-generated v4. The other branch is server configuration (`config.guestId`), not client input, so it is not exempt (it is not a UUID shape). Every other `guest-${crypto.randomUUID()}` site is a call argument (`registerBrowserSession`, `replaceInteractionSession`, guest-server.ts:7129, 7200, 7484, 7512), and each passes a server-generated `crypto.randomUUID()` value. The `guest-bootstrap-` prefix belongs to `guestId` (`apps/cloudflare/src/shortlet-pilot-do.ts`, `apps/pilot/src/pilot-server.ts`); it is a different prefix and key and is not in the table.

## Luhn gate (residual: about 1 in 3,000 at the current rule)

`containsLuhnValidCardShape` (`packages/platform-core/src/redaction.ts`) trips when either:

- (a) a match of the card rule's own regex (aligned 4-4-4-4 groups with optional single separators) is Luhn-valid, separators removed; or
- (b) a whole maximal run of 17 to 19 consecutive digits (hyphens removed) is Luhn-valid as a number.

Other 16-digit windows of a longer run are NOT tested (decided by the orchestrator, option 2). A tripped gate masks the whole value as `[REDACTED]`. Fall-through to the card regex is not enough: the regex matches only aligned 16-digit groups and would leave, for example, `889` of the 19-digit regression number.

**Where the card rule matches in an exact v4 id** (enumerated by test "The card rule matches a 16-digit window in a v4 platform id only at hex offsets 0 and 16"): the rule needs a hyphen or the string start before the 16 digits and a hyphen or the string end after them. In a v4 id that leaves hex offsets 0 and 16 only.

**PINNED LIMIT (documented, deliberate).** A Luhn-valid 16-digit card number at an UNALIGNED hex offset (1 to 15) of an exact v4 id is not detected and stays unchanged, as free text on main is (the card rule does not match it). The review example `req-aaaaaaaa-3352-4152-8480-7151aaaaaaaa` is such a case: its digits are followed by a letter, so the card rule's end boundary fails. This is defence in depth only: client-supplied ids are lookup-validated before audit, and the client-chosen `g-` thread ids are excluded. Tests named `PINNED LIMIT` pin it, so a change to the windows is deliberate (probe M15 widens the windows and must fail them).

**Covered:** card numbers at aligned offsets 0 and 16 under every key, key-name variant and nested object; whole 17-, 18- and 19-digit Luhn-valid runs at offsets 0 and 4 (the regression `req-21022665-8675-4290-889a-aaaaaaaaaaaa`, a Luhn-valid 19-digit run, is masked as on main); id values inside arrays.

**Not covered (same as main):** 13- to 15-digit numbers, and 13- to 19-digit numbers outside an id (the card rule matches only 16-digit groups). A 15-digit Amex-length number and a 19-digit Luhn-valid number in free text stay unchanged (pinned by tests).

**Measured residual**, over 1,000,000 random v4 ids (`req-${randomUUID()}`), with the final rule:

| Measure | Result |
| --- | --- |
| Card-shaped ids (the card regex matches) | 0.1331% (1,331 ids in one run; 1,269 in a second run) |
| Gate (a): card-rule match Luhn-valid | 133 ids: **about 1 in 7,500** (about 10% of card-shaped ids, as expected) |
| Gate (b): whole 17-19 digit run Luhn-valid | 177 ids: **about 1 in 5,650** (17-digit 95, 18-digit 55, 19-digit 27) |
| Total masked | 0.0342% in one run (342 ids, about **1 in 2,900**); about 1 in 3,200 in the split run (310 ids) |
| Ratio, masked to card-shaped | about 0.26 |

The expected figure of about 1 in 7,900 is the card-rule part (a) alone. Rule (b) adds about as much again, so the total is about 1 in 3,000. The human must accept this.

**Options for the human (not implemented here):**

1. Accept the current rule: about 1 in 3,000 platform ids lose correlation, with the 17-19 digit whole-run rule (required by the 19-digit regression).
2. Narrow rule (b) to 19-digit runs only: about 1 in 6,250 (the 19-digit regression stays covered; 17- and 18-digit whole runs are not).
3. Card rule matches only (drop rule b): about 1 in 7,500, but the 19-digit regression id is no longer masked. Not recommended by the orchestrator's requirement.
4. Drop the gate. Threat model: only platform generators write these keys, and the client-chosen thread ids are excluded.

## Answers to the review questions (from the code, behaviour unchanged)

- **Q1, what is `transactionRef` (`packages/platform-core/src/reconciliation.ts:215,240`, audited as `reservationId = res-${transactionRef}`)?** It is a caller-supplied payment reference. The platform's own payment references are minted as `psp_ref_<commandId8>_<timestamp>` (`domains/shortlet/src/card-payment.ts:333`) and sent to Paystack as the transaction `reference` (`apps/web/src/card-payment-application.ts:76`, `session.pspReference`). `docs/agents/coding-standards.md` treats payment references as bearer credentials. Caveat: the two reconciliation methods have no production caller in this repository (only tests call them), so the webhook source of `transactionRef` is unverified. Treat it as a payment reference. Follow-up: decide whether `res-${transactionRef}` (`reservationId`) and `transactionRef` must be masked, hashed, or excluded.
- **Q2, `providerReference` (audited at `packages/platform-core/src/provider-contracts.ts:118,129` and `packages/platform-core/src/reconciliation.ts:232,256`, not in `sensitiveKeys`)?** In practice it holds the PSP's own reference: for Paystack, the verification result's `reference` is returned as `pspReference` (`domains/shortlet/src/paystack.ts:173,200`), which is the platform-minted `psp_ref_` value. It is a payment reference, so it is a bearer credential under the coding standards and should not sit in audit rows unmasked. Follow-up (separate PR): add `providerReference` to `sensitiveKeys` or store a hash.
- **Q3, bare id strings inside arrays under a listed key?** They are not masked when clean. The review text said "masked (conservative)": that was wrong. A clean id in an array is exempt, as a scalar is. A Luhn-gated id in an array is masked. Test: `Platform ids inside arrays under a listed key follow the same rules as scalars`.
- **Q4, detection SQL.** It matches flat, exact-case, top-level keys only, which is how production writes them (camelCase, flat). Nested keys, `Offer_Id`-style variants and other casings are not found (pinned by a test). To extend: add the key to `PLATFORM_ID_PREFIXES_BY_KEY`, regenerate the SQL with `platformIdMaskedRowsSql` (`test/helpers/platform-id-fixtures.ts`), and paste it here. The test fails until this issue shows the regenerated SQL.
- **Q5, non-string values** (JSON numbers, booleans) under any key are returned unchanged on main and on this branch. Only strings are scanned. Pre-existing; pinned by a test.

## Follow-ups (recorded, not done)

- `test/receipt-blob-store.test.ts:89` is flaky: the receipt object key is a bare `randomUUID()`, and `/\+?234/i` matches the hex substring `234` in about 1 run in 1,300. Unrelated to redaction; the same test exists on origin/main. Seen once on CI (`verify`, head `e8008df`), rerun once and green.
- Payment references in audit, per `docs/agents/coding-standards.md`: `res-${transactionRef}` (`packages/platform-core/src/reconciliation.ts:245,251`, audited as `reservationId`) and `transactionRef` (Q1); `providerReference` (`provider-contracts.ts`, `reconciliation.ts:232,256`, not in `sensitiveKeys`; Q2). Decide masking, hashing or exclusion in a separate change.
- `THREAD_ID_PATTERN` (`apps/local-guest/src/guest-server.ts:578`) lets the client choose guest thread ids `g-<uuid>` (also masked in human-handoff audit rows, `packages/platform-core/src/human-handoff.ts:38-49`). Constrain it on the server first, then exempt `g` under `threadId`. Test `Guest thread ids (g-<uuid>) are not exempt under threadId` pins the current behaviour.
- `gs-<uuid>` session ids stay masked (orchestrator decision).
- The 13- to 15-digit and 17- to 19-digit card-number gap outside ids (see Needs user).

## Reproduction and evidence

Red run (the revised main test file `test/redact-platform-ids.test.ts`, 30 tests, against the previous gate from `e8008df`): 5 failing: the 20,000-id oracle for the in-memory check, the 20,000-id oracle for SQLite, the two PINNED LIMIT tests (an unaligned card and the review example, both masked by the window gate), and the "other windows are not tested" test. The card-number, wrong-prefix, non-v4 and sensitive-key tests passed before and after.

Flake loops (200 runs per file, 4-way parallel, `npx tsx --test <file>`; "after" is the final code):

| File | origin/main `redaction.ts` (before) | Final code (after) |
| --- | --- | --- |
| test/submit-and-resolve-timed-booking-request.test.ts | 2 of 200 failed (runs 139 and 170: audit lookups by a masked id, the original bug) | 0 of 200 failed |
| test/issue-and-accept-conditional-booking-offer.test.ts | 0 of 200 failed | 1 of 200 failed (run 183: `assert.ok(auditWeb)` at line 451, an audit lookup by `offerId`, consistent with a gated offer id; the id value is not logged, so not directly verified) |

Earlier campaigns: origin/main before, 5/200 and 3/200 (first) and 1/200 and 2/200 (second); head `4739992` (16-digit gate) after 0/200 and 0/200; head `e8008df` (all-window gate) after 2/200 and 2/200.

Honest reading: 200 runs cannot prove a rate of about 1 in 3,000 per file-run, and the expected count is 0 to 1 per 200. The one failure here is consistent with the residual, not proof of it.

## Test files and counts

- `test/redact-platform-ids.test.ts`: 30 tests (20,000-id checks for main and SQLite, the original negative cases, offsets 0 and 16 under every key and variant, nested objects, the enumeration of the card rule's offsets, 17- to 19-digit whole runs, the 19-digit regression, the PINNED LIMIT tests, Luhn-invalid ids unchanged, Amex and 19-digit free-text pins, end anchor, trailing newline, arrays, non-string pin, guest thread ids).
- `test/redact-platform-ids-precedence.test.ts`: 3 tests (sensitive key and tabled key in the same policy, via `createSensitiveDataRedactor`).
- `test/redact-platform-ids-generators.test.ts`: 5 tests (principalId ternary extraction, pairing, completeness, exclusions tied to key and files, generator closure).
- `test/redact-platform-ids-detection.test.ts`: 4 tests (detection over both tables, clean rows, issue shows the generated SQL, flat-key limitation).
- `test/helpers/platform-id-fixtures.ts`: shared fixtures and oracles (not a test file).

## Mutation probes (final code, each file run separately, restored after each run)

| Probe | Change | Result (failing tests) |
| --- | --- | --- |
| M1 | key guard removed | fails (3) |
| M2 | prefix guard removed | fails (2) |
| M3 | shape check removed | fails (5) |
| M4 | v4 nibble removed | fails (1) |
| M5 | Luhn gate removed | fails (9) |
| M6 | end anchor removed | fails (2) |
| M7 | exemption removed | fails (7) |
| M8 | exemption checked before `sensitiveKeys` | precedence test fails (1) |
| M9 | `token` added to the production table | generator pairing fails (1) and the issue-file check |
| M10 | `quote` prefix changed to `quotes` | fails (6) |
| M11 | exclusion key renamed (`sessionId`) | completeness and exclusion checks fail (2) |
| M12 | detection query drops `threadId` | detection fails (2) |
| M13 | `g` added to `threadId` | guest thread test fails (1) |
| M14 | fall-through instead of fail-closed | fails (9) |
| M15 | windows widened to any 16-digit window | fails (6), including both PINNED LIMIT tests |
| M16 | 17-19 digit whole-run rule removed | fails (3), including the regression |
| M17 | `principalId` removed from the table | completeness check fails (2) |
| M18 | `sessionId` exclusion names no files | exclusion check fails (1) |
| M19 | `commandEnvelopeId` alias broken | pairing fails (1) |
| M20 | card-rule matches not Luhn-tested (whole runs only) | fails (7) |

The issue-file check also fails in probes that change the table, because the SQL is generated from the table; that is the intended tie.

## Definition of Done (docs/agents/issue-tracker.md)

1. Every acceptance criterion has a named test. Yes (see the test files above).
2. Failure paths are asserted with exact expected output. Yes.
3. ADRs read and cited: 0075 (primary), 0070, 0071, 0079, 0093, 0096. Listed in the PR body.
4. No injected dependency unused: no constructor parameters were added. The seam is a factory with a policy argument, used by production and by the precedence test.
5. No policy string invented: the table is derived from generator and audit code. The Luhn gate is a technical rule with a measured residual and a documented PINNED LIMIT, which the human must accept (see Luhn gate).
6. No bearer credential in audit records: sensitive keys still win. The exemption covers only exact v4 shapes under the listed keys, with no Luhn-valid window. Payment references in `providerReference` and `transactionRef` are follow-ups (Q1, Q2), not changed here.
7. `npm run check` is clean. `npm run test:workers` and `npm run test:non-browser` pass locally. The browser phase is covered by the CI `browser` job on the final head (see the PR body for run URLs).
8. Committed and pushed. Status stays `ready-for-human` until the human accepts the Luhn residual and the 13–19 digit gap, and decides on the back-fill.

## Are rows already written recoverable?

No, not from the audit or telemetry tables alone. `redactSensitiveData` ran before insert, so `audit_log.payload_json` and `telemetry_events.payload_json` hold only the masked text. The original digits are not stored there. A partial reconstruction may be possible from domain tables that still hold the same ids, by matching the unmasked fragments (for example `offer-%-bea8-8d50c54c0c30`). That is not verified, not automated and not part of this change. No migration is written.

Detection query (SQLite JSON1), generated from `PLATFORM_ID_PREFIXES_BY_KEY` by `platformIdMaskedRowsSql` in `test/helpers/platform-id-fixtures.ts`. Tested against a throwaway SQLite database with legacy masked rows for every key, including `threadId` guest ids (`test/redact-platform-ids-detection.test.ts`). It matches flat, exact-case, top-level keys only (Q4).

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
   OR json_extract(payload_json, '$.principalId') LIKE '%[REDACTED]%'
   OR json_extract(payload_json, '$.aggregateId') LIKE '%[REDACTED]%'
ORDER BY id;
```

For `telemetry_events`, the same predicate on the same keys:

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
   OR json_extract(payload_json, '$.principalId') LIKE '%[REDACTED]%'
   OR json_extract(payload_json, '$.aggregateId') LIKE '%[REDACTED]%'
ORDER BY id;
```

The query finds rows only where a listed key was masked. It cannot find masked ids under keys outside the table, nested keys, or masked guest session ids (`sessionId`), which stay masked by design.

## Needs user

- Accept the Luhn-gate residual: about **1 in 3,000** platform ids (measured) lose correlation with the current rule (about 1 in 7,500 from the card-rule gate, plus about 1 in 5,650 from the 17- to 19-digit whole-run rule). Or choose option 2 (19-digit only, about 1 in 6,250). Also accept the documented PINNED LIMIT: a Luhn-valid 16-digit card at an unaligned offset of an exact v4 id is not detected (defence in depth only). Status stays `ready-for-human` until then.
- Decide the 13- to 15-digit and 17- to 19-digit card-number gap outside ids (pre-existing; a 15-digit Amex is not masked anywhere today).
- Decide the masking of payment references: `transactionRef` / `res-${transactionRef}` (Q1) and `providerReference` (Q2).
- Whether a migration or back-fill should run on production rows (not written here).
- Unprefixed `randomUUID()` values are not exempt (closed prefix set). No audited key holding one was found, but the scan is by key name and is not exhaustive.
- Non-UUID ids such as `res-${transactionRef}` can still be masked if they contain a digit run (see Q1).

## Comments

- CI run links for this change are in the PR body (https://github.com/cyruslayo/chat-marketplace/pull/105), including the dispatched `browser` run on the final head.
- Scope: this change is outside the guest-accounts effort (ga-08-sign-in-offer) and touches no guest-accounts files.
