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
2. If some run of 16 to 19 digits in the value is Luhn-valid (Luhn gate, below), the whole value is `[REDACTED]`. This is fail closed, whatever the value's shape.
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

## Luhn gate (residual risk: MEASURED LARGER THAN EXPECTED)

Without the gate, a Luhn-valid card number encoded in a v4 id would pass unmasked under a listed key. The gate now tests every 16-, 17-, 18- and 19-digit window of every digit run (hyphens removed, letters kept), at every alignment. A Luhn-valid window masks the whole value.

- Covered: a card number at any hex offset of the id (tested at offsets 0 to 16 under every key and key-name variant, including nested objects), 17- to 19-digit runs (the regression `req-21022665-8675-4290-889a-aaaaaaaaaaaa`, a Luhn-valid 19-digit run, is masked as on main), and id values inside arrays.
- Fail closed, not fall-through: a fall-through to the card regex is not enough, because the regex matches only aligned 16-digit groups and would leave, for example, `889` of that 19-digit number. A gated value is therefore replaced by `[REDACTED]`. This differs from the review text, which said "falls through to the normal string rules".
- Not covered (unchanged from main): 13- to 15-digit numbers, and 13 to 19 digit numbers outside an id. The card rule matches only 16-digit groups. A 15-digit Amex-length number stays unchanged in ids and free text (pinned by a test). A 19-digit Luhn-valid number in free text stays unchanged (pinned by a test).
- Measured residual over 1,000,000 random v4 ids (`req-${randomUUID()}`): **0.1438% are masked, 1,438 ids, about 1 in 695** platform ids lose correlation. Of those, 1,031 have no card-shaped match for the card regex at all: the loss comes from the all-window, all-alignment gate, not from the regex. The earlier estimate of about 1 in 8,000 assumed only the card regex's matches, and the all-alignment rule is about eight times broader. The orchestrator must decide.
- Flake effect: this residual makes the flaky files fail more often than the estimate. Failing ids were confirmed as gated ids (for example `cmd-f8cb7ab9-e397-4267-9804-1872226b263e` contains the Luhn-valid window `9742679804187222`). See the loop table below.
- Options for the human, not implemented here: (a) accept about 1 in 695 loss; (b) restrict the windows to the card regex's own aligned groups plus whole 17- to 19-digit runs, which would lose the misaligned-offset coverage but not the card-regex case; (c) drop the gate. The threat model matters for (b) and (c): only platform generators write these keys, and the client-chosen thread ids are excluded. A Luhn gate guards against a client writing a card number into an id, and that requires a client-influenced source, which the review found only for `g-` thread ids.

## Answers to the review questions (from the code, behaviour unchanged)

- **Q1, what is `transactionRef` (`packages/platform-core/src/reconciliation.ts:215,240`, audited as `reservationId = res-${transactionRef}`)?** It is a caller-supplied payment reference. The platform's own payment references are minted as `psp_ref_<commandId8>_<timestamp>` (`domains/shortlet/src/card-payment.ts:333`) and sent to Paystack as the transaction `reference` (`apps/web/src/card-payment-application.ts:76`, `session.pspReference`). `docs/agents/coding-standards.md` treats payment references as bearer credentials. Caveat: the two reconciliation methods have no production caller in this repository (only tests call them), so the webhook source of `transactionRef` is unverified. Treat it as a payment reference. Follow-up: decide whether `res-${transactionRef}` (`reservationId`) and `transactionRef` must be masked, hashed, or excluded.
- **Q2, `providerReference` (audited at `packages/platform-core/src/provider-contracts.ts:118,129` and `packages/platform-core/src/reconciliation.ts:232,256`, not in `sensitiveKeys`)?** In practice it holds the PSP's own reference: for Paystack, the verification result's `reference` is returned as `pspReference` (`domains/shortlet/src/paystack.ts:173,200`), which is the platform-minted `psp_ref_` value. It is a payment reference, so it is a bearer credential under the coding standards and should not sit in audit rows unmasked. Follow-up (separate PR): add `providerReference` to `sensitiveKeys` or store a hash.
- **Q3, bare id strings inside arrays under a listed key?** They are not masked when clean. The review text said "masked (conservative)": that was wrong. A clean id in an array is exempt, as a scalar is. A Luhn-gated id in an array is masked. Test: `Platform ids inside arrays under a listed key follow the same rules as scalars`.
- **Q4, detection SQL.** It matches flat, exact-case, top-level keys only, which is how production writes them (camelCase, flat). Nested keys, `Offer_Id`-style variants and other casings are not found (pinned by a test). To extend: add the key to `PLATFORM_ID_PREFIXES_BY_KEY`, regenerate the SQL with `platformIdMaskedRowsSql` (`test/helpers/platform-id-fixtures.ts`), and paste it here. The test fails until this issue shows the regenerated SQL.
- **Q5, non-string values** (JSON numbers, booleans) under any key are returned unchanged on main and on this branch. Only strings are scanned. Pre-existing; pinned by a test.

## Follow-ups (recorded, not done)

- Guest thread ids `g-<uuid>` (`apps/local-guest/src/guest-server.ts:9136,9188`, `apps/local-guest/src/client.ts:183,2454`) are still masked in human-handoff audit rows (`packages/platform-core/src/human-handoff.ts:38-49`). Constrain `THREAD_ID_PATTERN` (`guest-server.ts:578`) on the server first, then exempt `g` under `threadId`. Test `Guest thread ids (g-<uuid>) are not exempt under threadId` pins the current behaviour.
- `providerReference` is audited (`provider-contracts.ts`) but is not in `sensitiveKeys`, and it holds a payment reference (Q2). Pre-existing and separate.
- `transactionRef` / `res-${transactionRef}` (`reconciliation.ts`) holds a payment reference (Q1). Out of scope here; decide the masking.
- `gs-<uuid>` session ids stay masked (orchestrator decision).
- `res-${transactionRef}` ids are out of scope (see above).
- The 13- to 15-digit and 17- to 19-digit card-number gap outside ids (Needs user).

## Reproduction and evidence

Red run before the change (the revised test files against the previous code, captured before the redaction rewrite; 38 tests, 13 failing): the 20,000-id checks, the PAN-in-id tests (named and nested), the new offset, 17–19 digit, regression, array and trailing-newline tests, and the generator completeness and exclusion checks failed. The card-number, wrong-prefix, non-v4 and sensitive-key tests passed before and after.

Flake loops (200 runs per file, 4-way parallel, `npx tsx --test <file>`):

| File | origin/main `redaction.ts` (before) | Final code, this round (after) |
| --- | --- | --- |
| test/submit-and-resolve-timed-booking-request.test.ts | 1 of 200 failed (run 187: masked `cmd-…-[REDACTED]`, the original bug) | 2 of 200 failed (run 9: `disclosureAudit` lookup by a gated `req-` id; run 193: gated `cmd-` id) |
| test/issue-and-accept-conditional-booking-offer.test.ts | 2 of 200 failed (runs 75 and 132: masked `cmd-` and `offer-` ids, the original bug) | 2 of 200 failed (runs 64 and 83: gated `cmd-` ids) |

Previous code (the 16-digit gate, `4739992`): after 0 of 200 and 0 of 200. Earlier campaign on the first version: before 5/200 and 3/200; after 0/200 and 0/200. At about 1 in 750 to 1,000 runs per failure, 200 runs can show zero or one failure, so these numbers are indicative. The residual is above the expected 1 in 3,000 runs for these files, so the flake rate after this change is about one failure per 100 file-runs. This is the Luhn residual above, and it is the first thing the human should decide.

## Test files and counts

- `test/redact-platform-ids.test.ts`: 27 tests (20,000-id checks, the original negative cases, named and nested PAN-in-id masking, offsets 0 to 16 under every key and variant, 17- to 19-digit runs, the 19-digit regression, the misaligned example, Luhn-invalid windows at every offset, Amex and 19-digit free-text pins, end anchor, trailing newline, arrays, non-string pin, guest thread ids).
- `test/redact-platform-ids-precedence.test.ts`: 3 tests (sensitive key and tabled key in the same policy, via `createSensitiveDataRedactor`).
- `test/redact-platform-ids-generators.test.ts`: 5 tests (principalId ternary extraction, pairing, completeness, exclusions tied to key and files, generator closure).
- `test/redact-platform-ids-detection.test.ts`: 4 tests (detection over both tables, clean rows, issue shows the generated SQL, flat-key limitation).
- `test/helpers/platform-id-fixtures.ts`: shared fixtures and oracles (not a test file).

## Mutation probes (final code, each file run separately, restored after each run)

| Probe | Change | Result |
| --- | --- | --- |
| M1 | key guard removed | fails (4) |
| M2 | prefix guard removed | fails (3) |
| M3 | shape check removed | fails (7) |
| M4 | v4 nibble removed | fails (2) |
| M5 | Luhn gate removed | fails (11) |
| M6 | end anchor removed | fails (3) |
| M7 | exemption removed | fails (8) |
| M8 | exemption checked before `sensitiveKeys` | precedence test fails (1 test, plus the issue-file check) |
| M9 | `token` added to the production table | generator pairing fails (1) and the issue-file check |
| M10 | `quote` prefix changed to `quotes` | fails (7) |
| M11 | exclusion key renamed (`sessionId`) | completeness and exclusion checks fail (3) |
| M12 | detection query drops `threadId` | detection fails (2) |
| M13 | `g` added to `threadId` | guest thread test and pairing fail (2) |
| M14 | fall-through instead of fail-closed | fails (11) |
| M15 | Luhn windows limited to 16 digits | fails (4) |
| M16 | arrays not walked by the id rules | array test fails (1), plus the issue-file check |
| M17 | `principalId` removed from the table | completeness check fails (1) |
| M18 | `sessionId` exclusion names no files | exclusion check fails (1), plus the issue-file check |
| M19 | `commandEnvelopeId` alias broken | pairing fails (1), plus the issue-file check |

The issue-file check fails in the probe runs that alter the table, because the SQL is generated from the table; that is the intended tie.

## Definition of Done (docs/agents/issue-tracker.md)

1. Every acceptance criterion has a named test. Yes (see the test files above).
2. Failure paths are asserted with exact expected output. Yes.
3. ADRs read and cited: 0075 (primary), 0070, 0071, 0079, 0093, 0096. Listed in the PR body.
4. No injected dependency unused: no constructor parameters were added. The seam is a factory with a policy argument, used by production and by the precedence test.
5. No policy string invented: the table is derived from generator and audit code. The Luhn gate is a technical rule with a measured residual the human must accept (see Luhn gate).
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

- Accept or reject the Luhn-gate residual: about **1 in 695** platform ids (measured) lose correlation. The earlier 1-in-8,000 estimate assumed only the card regex's matches. The options are in the Luhn gate section. The flake rate of these two files after the change is about one failure per 100 file-runs (loop table).
- Decide the 13- to 15-digit and 17- to 19-digit card-number gap outside ids (pre-existing; a 15-digit Amex is not masked anywhere today).
- Decide the masking of payment references: `transactionRef` / `res-${transactionRef}` (Q1) and `providerReference` (Q2). Both hold payment references.
- Whether a migration or back-fill should run on production rows (not written here).
- Unprefixed `randomUUID()` values are not exempt (closed prefix set). No audited key holding one was found, but the scan is by key name and is not exhaustive.
- Non-UUID ids such as `res-${transactionRef}` can still be masked if they contain a digit run (see Q1).

## Comments

- CI run links for this change are in the PR body (https://github.com/cyruslayo/chat-marketplace/pull/105), including the dispatched `browser` run on the final head.
- Scope: this change is outside the guest-accounts effort (ga-08-sign-in-offer) and touches no guest-accounts files.
