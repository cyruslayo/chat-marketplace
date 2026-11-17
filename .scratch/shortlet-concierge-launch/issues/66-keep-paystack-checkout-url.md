# Keep the approved Paystack checkout address across a cold restore

Status: resolved
Type: task
Blocked by: 65 (same branch stack)
Requested: 17 Nov 2026

## Why

Found while building issue 65 (its Comments, deviation 5). The durable checkout session does not keep the Paystack `authorization_url`:

- `#persistSession` (`domains/shortlet/src/card-payment.ts`, around line 271) does not store `checkoutUrl`, and the durable row in `guest_checkout_sessions` (`domains/shortlet/src/guest-interaction-store.ts`, around line 442 and 1211) has no column for it. A restored session gets a placeholder `https://checkout.psp.example.com/pay/<ref>` (around lines 790 and 813).
- Every Worker request is a cold restore (ADR 0106), so `/payments/offers/<id>/continue` calls Paystack `POST /transaction/initialize` again with the same reference each time the guest follows the link. Issue 65's test 3 pins this as `[ref, ref]`.
- The reference, the checkout session and the Payment Window do not change, and the live staging journey of 17 Nov 2026 paid successfully. But Paystack's answer to a repeated reference is not verified offline, and an extra provider call per click adds latency and a failure point inside the 20-minute Payment Window (ADR 0044). There is also a remint path (`card-payment.ts`, around line 421) whose interaction with a repeated initialize is not documented.

## What to build

1. **Survey first** (record in Comments): every path that sets, reads or remints `checkoutUrl` and `pspReference`; what the Paystack adapter does with a repeated reference today (including any duplicate-reference error handling and the remint path); which tests pin the current behaviour.
2. **Persist the approved address.** Store the validated `authorization_url` with the durable checkout session when the server receives it from Paystack, in a new nullable column on `guest_checkout_sessions`, added the way `contact_email` was added (the guarded `ALTER TABLE ... ADD COLUMN` in the store, around line 729), plus whatever schema migration the shortlet migration list needs so the Worker store gets it too.
3. **Reuse it.** `/continue` reuses the stored address while the same Live Payment Attempt is active and inside its Payment Window; it initializes Paystack only when no address is stored, or after a remint gives a new reference (ADR 0046).
4. **Validate on read.** A stored address is used only if it is `https:` on the approved Paystack checkout host for the provider environment the session records (`providerEnvironment`). Anything else fails closed: initialize again rather than redirect to it.
5. **Never log or echo it.** The address is a payment-page link. It is never written to logs, audits, the timeline, exports' guest-visible text or any guest response body (ADR 0075). Check the daily export: if `guest_checkout_sessions` is exported, decide with the owner whether the column is excluded (record the decision).

## ADRs to read first

| ADR | Constraint | Where it lands |
| --- | --- | --- |
| 0087 | The server initializes Paystack and issues the only `authorization_url`; the browser never supplies the destination. | Steps 2 to 4. |
| 0046 | One Live Payment Attempt; a superseded or reminted reference is ignored. | Step 3; AC 3. |
| 0044 | Payment Window, 20 minutes after Accept Offer. | Step 3; AC 4. |
| 0106 | Every Worker request is a cold restore. | Why; AC 1. |
| 0075 | No bearer or provider material in logs, audits or interaction data. | Step 5; AC 6. |
| 0096 | Export coverage and its exemptions. | Step 5. |

## Acceptance criteria

Each is its own `test()` in `test/card-checkout-url-persistence.test.ts` (new), with a cold restore before every event, clock 2026-10-27, a staging-like guest, and a fake Paystack client that counts initialize calls.

1. After a cold restore, following `/continue` twice for the same attempt calls Paystack initialize once and redirects both times to the same stored address.
2. The stored address survives a restore of the durable row (node SQLite store and the Worker store).
3. A remint (new reference) initializes Paystack again and stores the new address; the old address is never used again.
4. After the Payment Window closes, `/continue` does not redirect to the stored address (the existing expiry behaviour holds).
5. A stored address on another host, another scheme or the wrong provider environment is not used (fail closed: initialize again).
6. The address appears in no log line, audit record, timeline entry or guest response body.
7. Issue 65's test 3 is updated deliberately from `[ref, ref]` to one initialize call, with the reason recorded in Comments.

## Verification

- `env -u LLM_API_KEY npm run check`.
- `env -u LLM_API_KEY npx tsx --test test/card-checkout-url-persistence.test.ts test/card-checkout-after-email.test.ts test/assistant-paystack-checkout-contact.test.ts` plus the payment-continuation, Paystack adapter and store tests the survey names.
- Workers: the export and migration specs that cover `guest_checkout_sessions` (`npm run test:workers -- <spec path>`, one spec per command).
- Real Chrome, solo: `test/paystack-real-browser.test.ts`.
- Live, after the owner's deploy: on staging, follow the chat link and the page link to checkout; both reach `checkout.paystack.com`. Stop before card entry.

## Out of scope

- Bank transfer and manual transfer (ADR 0088).
- The known gap that a late `charge.success` on a superseded reference is ignored (ADR 0046).

## Comments

- Owner, 17 Nov 2026: "let us fix it all" — release this issue to build on top of 65.

### Survey (agent, 17 Nov 2026, before any code change)

Paths that set, read or remint `checkoutUrl` and `pspReference`:

- **Placeholder sets:** `domains/shortlet/src/card-payment.ts:365` (mint in `initializeCardCheckout`), `:421` (`remintUnboundCheckoutReference`), `:790` and `:813` (hydration of a stored row in `getCheckoutSession` and `getCheckoutSessionByReference`). The placeholder `https://checkout.psp.example.com/pay/<ref>` is not an approved host.
- **Real URL set:** `card-payment.ts:429` `updateCheckoutUrl`, called only from `apps/web/src/card-payment-application.ts:231` after `payments.start`. It updates the in-memory session and calls `#persistSession`, which (`card-payment.ts:271`) drops `checkoutUrl`. The approved address therefore exists only in memory and is lost on a cold restore.
- **Reads:** `card-payment-application.ts:213` is the reuse guard (initiated, `providerEnvironment` recorded, `isApprovedPaystackCheckoutUrl`). After a restore the placeholder fails it, so `/continue` calls `payments.start` again with the same reference. `apps/local-guest/src/guest-server.ts:4920` (`/payments/offers/:id/continue`) and `:5163` (period start) check the returned URL is approved before the 303.
- **Remint:** `card-payment-application.ts:218` remints only when `providerEnvironment` is undefined and the stored reference is not platform format. `card-payment.ts:411` refuses a bound session (environment recorded) and a platform reference. A stored address is only ever written together with `providerEnvironment` (`updateCheckoutUrl`), so a stored address can never be reminted. The two are mutually exclusive by construction.
- **Adapter:** `packages/platform-core/src/payments/paystack.ts`. One validation rule, `isApprovedPaystackCheckoutUrl` (line 118: https, host `checkout.paystack.com`, no credentials, no fragment). It is used by `initializeTransaction` (line 246, `checkout_url_rejected`) and by the two guest-server routes. This change reuses it and adds no second rule.
- **Repeated reference:** no special handling exists. A non-conforming reference is refused before fetch (`reference_conflict`, line 211). A returned different reference is `reference_conflict` (line 244). An identical repeated reference is sent like any other. How Paystack answers a repeated reference is still not verified offline (the finding in issue 65). No duplicate-reference error mapping exists, so none is kept or changed.
- **Store:** `guest_checkout_sessions` DDL at `domains/shortlet/src/guest-interaction-store.ts:442` (no URL column). Save `:1212`, find by id `:1247`, by offer `:1283`, by reference `:1294`. The constructor's guarded `ALTER TABLE` for `contact_email` and `provider_environment` is at `:728` to `:741`. The same class is built by the Node composition (`apps/local-guest/src/fixture.ts:428`) and the Cloudflare composition (`apps/cloudflare/test/demo-extended-stay.spec.ts:317` over `DurableObjectSqlDatabase`).
- **Schema:** `apps/cloudflare/src/schema.ts` `BASELINE_STATEMENTS` includes the `GUEST_INTERACTION_SCHEMA` text, so editing that CREATE TABLE text would change the pinned `SHORTLET_MIGRATIONS_SHA256` in `test/platform-thread-ddl.test.ts`. Plan: a guarded `ALTER TABLE ... ADD COLUMN checkout_url TEXT` in the constructor only. No CREATE text change and no new shortlet migration, so the pinned hash and `SHORTLET_SCHEMA_VERSION` stay as they are. `PLATFORM_SCHEMA_VERSION` stays 5.
- **Export:** `apps/cloudflare/src/do-export.ts` lists `guest_checkout_sessions` in `SHORTLET_EXPORT_TABLES` (line 28). `PROJECTIONS` has no entry for it, so the default `*` would export a new column. Plan: a projection that excludes `checkout_url` by default (open owner confirmation).
- **Logs and audit:** `card_payment.checkout_initialized` (card-payment.ts, around line 395) carries no URL. `payment_continuation_rejected` lines carry no URL (ADR 0075). The URL reaches a guest response only as the intended 303 `Location` header.
- **Tests that pin current behaviour:** `test/card-checkout-after-email.test.ts` AC3 pins `[ref, ref]` (updated under AC7). `test/assistant-paystack-checkout-contact.test.ts:117` to `:125` pins one initialization on resume after the email save; the fix keeps it. `test/paystack-psp-reference-format.test.ts` remint test at `:105` (one accepted initialization on retry) is unchanged. `test/payment-callback-page.test.ts:77`, `test/paystack-pilot.test.ts:155` to `:159` and `test/platform-payments.test.ts:87` to `:88` are unchanged. Workers: `demo-extended-stay.spec.ts:211` and `later-period-payments.spec.ts:96` (period path, not changed), `payment-continuation-log.spec.ts` (log text, not changed).
- **Extra finding (beyond the issue text):** `card-payment-application.ts:213` returns an in-memory approved session with no expiry check. A restored placeholder session reaches `payments.start` after the Payment Window closes, because `initializeCardCheckout`'s expiry check runs only for a new session. AC4 closes both.

Decisions:

- D1. Nullable `checkout_url` column on `guest_checkout_sessions`, added by a guarded `ALTER TABLE` in the store constructor, as `contact_email` was. No CREATE text change, no shortlet migration, no pinned-hash change. Node and Cloudflare share this constructor, so the Worker store gets the column too.
- D2. Persist only an approved https address. The placeholder is never written.
- D3. Validate on read (hydration in `card-payment.ts`). A stored address is exposed only when it is approved and the session records `providerEnvironment`. Otherwise the placeholder is returned, which fails the reuse guard and initializes again (fail closed).
- D4. Reuse guard (`card-payment-application.ts`): the stored address, a recorded environment, the same environment as the Payments port when the port reports one (new optional `Payments.environment`, implemented by `PaystackPayments`), and the Payment Window still open.
- D5. An initiated session whose Payment Window has closed refuses `/continue` with the domain's own message ("Payment window has expired; cannot initialize checkout"). No initialize call and no redirect.
- D6. Export: a projection for `guest_checkout_sessions` excludes `checkout_url`. Owner confirmation below.

Open owner confirmations (not blocking):

1. Keep `checkout_url` out of the daily export (D6 default). The payment-page link is a provider token; the export would otherwise carry it in plaintext (ADR 0096 covers references only).
2. A restore from an export that lacks the column gives sessions with no address. The first `/continue` after such a restore initializes Paystack once for the same reference (fail closed).
### Owner decisions (17 Nov 2026, recorded by the coordinator)

1. Amend ADR 0087 with a dated amendment (done, see below). The Paystack-approved checkout address may be stored with the durable checkout session, on five conditions: validated on read, reused only while the attempt is live, never used after the attempt ends, never in logs, telemetry, audit, the timeline or a guest response body, and excluded from the daily and migration exports.
2. Exclude the address from both exports, as built. Restore from an export gives one fresh initialize on the first continue, for the same reference (recorded as an owner-accepted consequence).
3. The "never used after the attempt ends" condition holds in code and in a test. The smaller change was chosen: a write-side clear plus a read-time gate, not a separate transition hook. See Implementation below.

### Implementation after the owner decisions (agent)

- ADR 0087: dated amendment paragraph inserted after the persistence rule (the rule at line 54 is unchanged). The ADR file keeps CRLF line endings.
- The address is kept only while the attempt is `initiated`. `storableCheckoutUrl` (`domains/shortlet/src/card-payment.ts`) writes it only when the status is `initiated`, the provider environment is recorded and the URL is approved. Any other write (completed by verification at `card-payment.ts` around lines 598 and 730, failed, expired) therefore clears the column. `restoredCheckoutUrl` applies the same gate on read, so an ended row that still holds an address exposes only the placeholder. The application's reuse guard already requires `status === "initiated"`.
- Expiry: `apps/web/src/card-payment-application.ts` refuses a continuation of an initiated attempt whose Payment Window has closed, before any reuse or provider call. Reuse also requires `payments.environment === session.providerEnvironment`; a port that reports no environment initializes again (fail closed, no fallback).
- Exports: `EXPORT_EXCLUDED_COLUMNS` in `packages/platform-core/src/data-migration.ts` (`guest_checkout_sessions: checkout_url`) with `exportedRow()`, applied in the daily export (`apps/cloudflare/src/do-export.ts`), `buildExport` and `checksumTables`. The source and its target checksum the same columns.
- Schema: no migration. The column is added only by the guarded `ALTER TABLE` in the `SqliteGuestInteractionStore` constructor (as `contact_email` and `provider_environment` were). `SHORTLET_SCHEMA_MIGRATIONS`, its pinned hash in `test/platform-thread-ddl.test.ts`, and `PLATFORM_SCHEMA_VERSION` (5) are unchanged. Reason: a migration `ADD COLUMN` cannot be re-run safely on a database the constructor has already altered (SQLite has no `ADD COLUMN IF NOT EXISTS`).

### Survey (recorded before code, unchanged)

See the survey above. Summary of the survey's conclusions carried into the build: the placeholder `https://checkout.psp.example.com/pay/<ref>` is not an approved host; the approved address existed only in memory; the reuse guard in `card-payment-application.ts` skipped the Payment Window check; the remint path is mutually exclusive with a stored address (both are written together with `providerEnvironment`); `isApprovedPaystackCheckoutUrl` is reused, not duplicated; the adapter has no special handling for a repeated reference.

### ADR table (read in full where the survey read only part)

| ADR | Constraint | Where it lands |
| --- | --- | --- |
| 0087 | Server issues the only redirect; the persistence list names what may be stored. The checkout address is added by the amendment above. | `storableCheckoutUrl`, `restoredCheckoutUrl`, `initializePaystackCheckout` reuse guard; ADR amendment. |
| 0046 | One Live Payment Attempt; reuse only within it. | Reuse guard requires `initiated` and the same environment. AC3 remint test. |
| 0044 | No continuation after the Payment Window closes. | Expiry check before reuse; AC4 app and route tests. |
| 0106 | Every request is a cold restore. | Every test follows the continuation on a fresh process. |
| 0075 | No payment-page link in logs, audit, timeline or guest bodies. | Token scan of the database (less the address column), console capture, guest state and redirect body; AC6. |
| 0096 | Export coverage; the plaintext exemption covers the references only, not the address. | Address excluded from exports (`EXPORT_EXCLUDED_COLUMNS`). |
| 0101 | Export and restore span the objects; the migration uses the export and import path. | Exclusion applied on the migration path too. |

### Deviations

1. The survey plan excluded the column from the daily export only. The build also excludes it from the migration export and the checksums (`buildExport`, `checksumTables`), because a source and target with different columns would fail the cutover checksum. Recorded here; the owner confirmed the exclusion as built.
2. Added to the issue's scope: the expiry check (the survey's extra finding) and the environment equality guard (survey point 2).
3. The Worker half of AC2 is a Worker spec assertion in `apps/cloudflare/test/daily-export.spec.ts` (name "Issue 66 AC2 (Worker)"), not in the node test file.
4. The card-payment comment "ADR-0075: the PSP checkout URL is derived, never persisted" is replaced by the issue 66 rule. No test pins the old comment (grep: none).
5. ADR 0087 said the persistable list excluded the checkout URL. The owner amendment (17 Nov 2026) is the authority for storing it; the ADR now says so.

### Red run (before the change; recorded in the first comments block)

`env -u LLM_API_KEY npx tsx --test test/card-checkout-url-persistence.test.ts`: 9 tests, 2 pass, 7 fail. Failures: the app-level AC1 (2 initializes, expected 1); the route AC1 (count 2, expected 1); AC2 and AC5 (`no such column: checkout_url`, before the column existed); AC3 (the placeholder address, and no such column); AC4 app (no rejection); AC4 route (303, expected 400). Guards green before the change: the log/audit/timeline scan and the route AC6. `test/card-checkout-after-email.test.ts`: the issue 65 AC3 test failed as intended (`[ref, ref]` vs `[ref]`).

### Assertions changed in existing tests

- `test/card-checkout-after-email.test.ts`, the restored-continue test (issue 65 test 3, AC7): `[first.pspReference, first.pspReference]` changed to `[first.pspReference]`. Reason: the durable session now keeps the approved address, so the restored continue reuses it and initializes nothing. The comment that pinned the known gap is replaced.
- The local helpers `handoffAfterEmailSave`, `handoffWithEmailOnFile`, `CHECKOUT_MESSAGE` moved to `test/helpers/paystack-checkout-journey.ts` (unchanged bodies). `switchableFetcher` and `startRefusedCheckout` moved from `test/paystack-psp-reference-format.test.ts` to the same helper (unchanged bodies). No assertion in those files changed.
- `test/helpers/paystack-http.ts`: `authorizationUrl` may be a function of the reference (default unchanged).

### Test set (new tests, final)

`test/card-checkout-url-persistence.test.ts` (10 tests): cold restore continue twice (AC1); AC1 at the route; the stored address survives a restore and the legacy-column re-add (AC2); the remint (AC3); the closed Payment Window (AC4, app); AC4 at the route; the wrong host, scheme and environment, and missing environment (AC5); no log, audit, timeline or body (AC6); AC6 at the route; an ended attempt never reuses a stored address (added by the owner's condition 3).

### Commands and pass counts (final, after all code changes)

- `env -u LLM_API_KEY npm run check`: exit 0.
- `env -u LLM_API_KEY npx tsx --test test/card-checkout-url-persistence.test.ts test/card-checkout-after-email.test.ts test/paystack-psp-reference-format.test.ts`: 26 tests, 26 pass.
- Broader node set (`env -u LLM_API_KEY npx tsx --test` over test/card-checkout-url-persistence, card-checkout-after-email, assistant-paystack-checkout-contact, platform-thread-ddl, schema-migrations, paystack-pilot, paystack-psp-reference-format, platform-payments, paystack-transfer-adapter, card-checkout-failure-diagnostic, payment-callback-page, payment-continuation-diagnostic, integrate-card-payment-application, integrate-security-deposit-payment, export-node-sqlite, slice-09a-payments-facade, pilot-database-handle, later-period-payment-routes, pay-each-demo-billing-period, guest-payment-choice, guest-offer-payment-clarity, guest-payment-consistency, guest-must-fix-ux, assistant-cold-journey, timeline-email-masking, cutover-marker, pilot-local): 262 tests, 262 pass.
- Workers, one spec per command (`env -u LLM_API_KEY npm run test:workers -- apps/cloudflare/test/<spec>.spec.ts`): daily-export 12/12; data-migration 29/29; restore-from-export 4/4 (the first run in an earlier session hit a cloudflare-pool start timeout, not a test failure; the solo re-run passed); later-period-payments 1/1; demo-extended-stay 3/3; payment-continuation-log 6/6; card-checkout-log 6/6. The Worker run after the status gate is the one recorded here.
- Real Chrome, solo: `env -u LLM_API_KEY npx tsx --test test/paystack-real-browser.test.ts`: 1/1 (no DNS retry needed).
- Not run: full `npm test` and full `npm run test:workers` (batch gate, not per issue).

### Owner confirmations (open after this commit)

1. Confirm the export exclusion of `checkout_url` (daily and migration), as built. Owner confirmed on 17 Nov 2026.
2. A restore from an export gives one fresh initialize on the first continue for the same reference (owner accepted).
3. The ADR 0087 amendment (17 Nov 2026) is recorded; the owner should review its wording before merge to main.

### Definition of Done (docs/agents/issue-tracker.md)

1. Each AC has a named test that mirrors its criterion text; AC7 is the deliberate change of issue 65 test 3.
2. Failure paths: the wrong host, scheme and environment (AC5), the closed window (AC4), the ended attempt, and the legacy-row fail-closed path (AC2).
3. ADRs read and recorded (table above) and the amendment written.
4. No new injected dependency; `Payments.environment` is optional and read, not injected.
5. No invented policy string: the window message is the domain's existing text.
6. No address in logs, audit or guest bodies (AC6 scan, export exclusion).
7. `npm run check` exit 0.

Status: resolved.
