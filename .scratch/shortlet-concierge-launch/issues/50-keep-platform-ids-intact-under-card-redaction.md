# Keep platform ids intact under the card-number redaction rule

Status: resolved
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
2. If the Luhn gate trips (a match of the card rule's own regex is Luhn-valid; see the Luhn gate section), the whole value is `[REDACTED]`. This is fail closed, whatever the value's shape.
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

The site is `apps/local-guest/src/guest-server.ts` (the session-scoped principal): `const principalId = sessionScopedGuestPrincipals ? \`guest-${crypto.randomUUID()}\` : app.environment.config.guestId`. The `guest-<uuid>` branch is server-generated v4. The other branch is server configuration (`config.guestId`), not client input, so it is not exempt (it is not a UUID shape). The other four `guest-` sites were call arguments that passed a bare `guest-${crypto.randomUUID()}`: `registerBrowserSession` at `apps/local-guest/src/guest-server.ts:2323` and `replaceInteractionSession` at `:2424`, `:2709` and `:2737`. They now call `generatePlatformId("guest")` (commit ff3fd19), and the coverage test fails on any tabled-prefix template in a call argument. The `guest-bootstrap-` prefix belongs to `guestId` (`apps/cloudflare/src/shortlet-pilot-do.ts:252`, `apps/pilot/src/pilot-server.ts:85`). It is not a tabled key, and it is an accepted residual (see Follow-ups).

## Luhn gate (generated ids are redrawn; raw draws trip about 1 in 8,000, plus two documented limits)

`containsLuhnValidCardShape` (`packages/platform-core/src/redaction.ts`) trips when a match of the card rule's own regex (`CARD_NUMBER_SHAPE`: 16 digits in aligned 4-digit groups, optional single separators) is Luhn-valid once the separators are removed. A tripped gate masks the whole value as `[REDACTED]`. The exemption is never wider than the card rule's own coverage.

Fall-through to the card regex is not used: a tripped gate is replaced whole, so no part of a gated number survives.

**Where the card rule matches in an exact v4 id** (enumerated by test "The card rule matches a 16-digit window in a v4 platform id only at hex offsets 0 and 16"): the rule needs a hyphen or the string start before the 16 digits and a hyphen or the string end after them. In a v4 id that leaves hex offsets 0 and 16.

**Documented limits (PINNED, deliberate; tests named `PINNED LIMIT`):**

1. **Unaligned 16-digit offsets.** A Luhn-valid 16-digit card number at an UNALIGNED hex offset (1 to 15) of an exact v4 id is not matched by the card rule, so it is not detected and stays unchanged. The review example `req-aaaaaaaa-3352-4152-8480-7151aaaaaaaa` is such a case: its digits are followed by a letter, so the card rule's end boundary fails. Same as free text on main.
2. **13- to 15-digit and 17- to 19-digit numbers.** The card rule matches only 16-digit groups, anywhere (ids or free text). So a Luhn-valid 17- to 19-digit number in an id, including the 19-digit `req-21022665-8675-4290-889a-aaaaaaaaaaaa`, stays unchanged, as in free text on main. A 15-digit Amex-length number stays unchanged too. The id context equals free text.

Defence in depth only: client-supplied ids are lookup-validated before audit, and the client-chosen `g-` thread ids are excluded.

**Covered:** card numbers at aligned offsets 0 and 16 under every key, key-name variant and nested object; id values inside arrays.

**Measured residual**, over 1,000,000 random v4 ids (`req-${randomUUID()}`), final rule (rule (a) only):

| Measure | Result |
| --- | --- |
| Card-shaped ids (the card regex matches) | 0.1381% (1,381 ids) |
| Masked ids | 125 ids (0.0125%): **about 1 in 8,000** |
| Ratio, masked to card-shaped | 0.09 (about one in ten card-shaped ids is Luhn-valid, as expected) |
| Masked without a card-regex match | 0 |

Earlier runs of the same rule measured 0.1331% card-shaped (1,331 ids) and about 1 in 7,500 masked (133 ids in a split run). The rule (a) residual is therefore about 1 in 7,500 to 8,000 platform ids for ids that are not redrawn. Since commit ff3fd19, `generatePlatformId` (`packages/platform-core/src/platform-id.ts`) redraws any uuid that trips the gate, so platform-generated ids carry no residual. The measured raw trip rate of random v4 draws is 508 of 4,000,000 (1 in 7,874).

**Dropped:** the whole-run 17- to 19-digit rule (earlier options 2 and 3). It added about 1 in 5,650 more loss (177 of 1,000,000) to cover a case the card rule never matched anywhere. It is removed, and the 19-digit case is now a pinned limit.

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
- Accepted residual: `guest-bootstrap-<uuid>` (`apps/cloudflare/src/shortlet-pilot-do.ts:252`, `apps/pilot/src/pilot-server.ts:85`) is the pilot bootstrap guestId. Its prefix and key are not in the table and it is not generated by `generatePlatformId`, so a value that trips the gate is masked whole, at the raw trip rate of about 1 in 8,000.
- The 13- to 15-digit and 17- to 19-digit card-number gap outside ids (see Needs user).

## Reproduction and evidence

Red run (the revised main test file against the previous gate, `144184d`): 29 tests, 4 failing: the two 20,000-id oracles (in-memory and SQLite), and the two pinned-limit tests for 17- to 19-digit numbers (the 19-digit regression and the whole-run cases), which the previous gate masked. The card-number, wrong-prefix, non-v4 and sensitive-key tests passed before and after.

Flake loops (200 runs per file, 4-way parallel, `npx tsx --test <file>`; "after" is the final code, rule (a) only):

| File | origin/main `redaction.ts` (before) | Final code (after) |
| --- | --- | --- |
| test/submit-and-resolve-timed-booking-request.test.ts | 1 of 200 failed (run in this round: audit lookup by a masked id, the original bug) | 1 of 200 failed (run 6: `cmd-92711166-4784-4767-af17-f383bc7e7fc5` is masked because its aligned card match `92711166-4784-4767` is Luhn-valid; a gate trip, the residual) |
| test/issue-and-accept-conditional-booking-offer.test.ts | 2 of 200 failed (audit lookups by a masked id, the original bug) | 0 of 200 failed |

Earlier campaigns: origin/main before, 5/200 and 3/200 (first), 1/200 and 2/200 (second), 2/200 and 0/200 (third); head `4739992` (16-digit gate) after 0/200 and 0/200; head `e8008df` (all-window gate) after 2/200 and 2/200; head `144184d` (rule (a) + whole-run 17-19) after 0/200 and 1/200.

Honest reading: 200 runs cannot prove a rate of about 1 in 8,000 ids per run, because each test touches several ids per run. The expected count is 0 to 1 failures per 200. The observed failures are explained by the residual (a gate trip on an aligned Luhn-valid card match), not by a logic error.

## Test files and counts

- `test/redact-platform-ids.test.ts`: 29 tests (20,000-id checks for main and SQLite against the card rule's gate, the original negative cases, offsets 0 and 16 under every key and variant, nested objects, the enumeration of the card rule's offsets, the PINNED LIMIT tests for unaligned 16-digit offsets, the review example, 13-19 digit numbers (the 19-digit regression included), Luhn-invalid ids unchanged, Amex and 19-digit free-text pins, end anchor, trailing newline, arrays, non-string pin, guest thread ids).
- `test/redact-platform-ids-precedence.test.ts`: 3 tests (sensitive key and tabled key in the same policy, via `createSensitiveDataRedactor`).
- `test/redact-platform-ids-generators.test.ts`: 5 tests (principalId ternary extraction, pairing, completeness, exclusions tied to key and files, generator closure).
- `test/redact-platform-ids-detection.test.ts`: 4 tests (detection over both tables, clean rows, issue shows the generated SQL, flat-key limitation).
- `test/helpers/platform-id-fixtures.ts`: shared fixtures and oracles (not a test file).

Total: 41 tests across the four files.

## Mutation probes (final code, each file run separately, restored after each run)

| Probe | Change | Result (failing tests) |
| --- | --- | --- |
| M1 | key guard removed | fails (2) |
| M2 | prefix guard removed | fails (2) |
| M3 | shape check removed | fails (5) |
| M4 | v4 nibble removed | fails (1) |
| M5 | Luhn gate removed | fails (7) |
| M6 | end anchor removed | fails (2) |
| M7 | exemption removed | fails (8) |
| M8 | exemption checked before `sensitiveKeys` | precedence test fails (1) |
| M9 | `token` added to the production table | generator pairing fails (1), issue-file check (1) |
| M10 | `quote` prefix changed to `quotes` | fails (6) |
| M11 | exclusion key renamed (`sessionId`) | completeness and exclusion checks fail (2) |
| M12 | detection query drops `threadId` | detection fails (2) |
| M13 | `g` added to `threadId` | guest thread test fails (1) |
| M14 | fall-through instead of fail-closed | fails (5) |
| M15 | windows widened to any 16-digit window | fails (2), including the unaligned PINNED LIMIT and the review example |
| M16 | 17-19 digit whole-run rule added back | fails (4), including the 17-19 digit PINNED LIMIT and the 19-digit regression |
| M17 | `principalId` removed from the table | completeness fails (2) |
| M18 | `sessionId` exclusion names no files | exclusion check fails (1) |
| M19 | `commandEnvelopeId` alias broken | pairing fails (1) |
| M20 | card-rule matches not Luhn-tested | fails (7) |

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

- Confirm the redraw approach (commit ff3fd19): platform-generated ids are redrawn when they trip the Luhn gate, so they no longer lose correlation. This removes the residual for generated ids only; raw draws still trip about 1 in 8,000, and the earlier accepted residual (about 1 in 7,500 to 8,000) is superseded for generated ids.
- Accept the two documented limits (PINNED LIMITS):
  1. a Luhn-valid 16-digit card at an unaligned hex offset (1 to 15) of an exact v4 id is not detected;
  2. 13- to 15-digit and 17- to 19-digit numbers are not detected in ids (the card rule matches only 16-digit groups anywhere; the same as free text on main).
- Decide the masking of payment references: `transactionRef` / `res-${transactionRef}` (Q1) and `providerReference` (Q2).
- Whether a migration or back-fill should run on production rows (not written here).
- Unprefixed `randomUUID()` values are not exempt (closed prefix set). No audited key holding one was found, but the scan is by key name and is not exhaustive.
- Non-UUID ids such as `res-${transactionRef}` can still be masked if they contain a digit run (see Q1).

Status stays `ready-for-human` until the first two items are accepted.

## Comments

- CI run links for this change are in the PR body (https://github.com/cyruslayo/chat-marketplace/pull/105), including the dispatched `browser` run on the final head.
- Scope: this change is outside the guest-accounts effort (ga-08-sign-in-offer) and touches no guest-accounts files.

### 11 Oct 2026: human decision

- Decision: the user replied "merge 105" to a message that asked them to:
  1. accept the residual of about 1 in 8,000 platform ids masked whole on a Luhn-valid aligned card match (see "Luhn gate");
  2. accept the two documented limits: a Luhn-valid 16-digit card at an unaligned offset 1 to 15 of an exact v4 id is not detected; 13 to 15 and 17 to 19 digit numbers in ids are not detected (the card rule has never matched them anywhere).
- Merged: PR #105 merged as 8b23923 on 11 Oct 2026.
- CI on the main push, run 38156816936 (https://github.com/cyruslayo/chat-marketplace/actions/runs/38156816936), checked 11 Oct 2026 at about 16:48 UTC: `verify` completed with success (npm run check, test:workers and test:non-browser all success). `browser` was still in progress at the time of the check (its "Real-browser tests (one file at a time)" step was in progress; run overall status `in_progress`, conclusion empty). The browser conclusion is not yet recorded here and should be checked on the run page.
- Open follow-ups (not decided, not filed):
  - `test/receipt-blob-store.test.ts:89` is flaky (about 1 in 1,300).
  - Payment references in audit: `res-${transactionRef}` (`packages/platform-core/src/reconciliation.ts:245,251`) and `providerReference`.
  - `THREAD_ID_PATTERN` (`apps/local-guest/src/guest-server.ts:578`) must be constrained before `g-` thread ids are exempted.
  - 13 to 19 digit card gap (see the pinned limits above).
  - Back-fill of already-redacted production audit rows (not recoverable from the audit tables; detection query in this issue).

### 18 Oct 2026: generator fix and follow-up

- Fix 14 was re-scoped. Exact v4 ids can carry a Luhn-valid PAN, and the pinned tests (ADR 0075, ADR 0096 export) require masking it, so the redactor is unchanged. Instead, platform-generated ids are redrawn when they trip the gate: commit ff3fd19 adds `generatePlatformId` and switches every tabled-prefix generator to it. The coverage test (`test/redact-platform-ids-generators.test.ts`) fails on any tabled-prefix template in a call argument.
- Related commits on `platform/18oct-fixes`: 2d9b6c3 (constant-time provider signature check), 2a6814c (constant-time registry comparison), 6ee1d72 (ADR 0103 replay note), 6bb8767 (listing viewer count).
