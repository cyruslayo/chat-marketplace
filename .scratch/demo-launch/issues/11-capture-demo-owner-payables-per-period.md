# Capture demo Owner Payables per Billing Period

Status: resolved
Type: AFK
Blocked by: 10

## Parent

[Public Live Demo Launch PRD](../PRD.md)

## Why

A six-period booking needs an immutable Owner Payable for each period. One booking-level payable would not represent the per-period price and payment schedule.

## What to build

- Extend the existing `owner-payable.ts` path and booking snapshot. Do not create a parallel payable model.
- Capture one Period Owner Payable per Billing Period at confirmation, using the agreed monthly amount for full periods and nightly amounts for a shorter final period.
- Keep ADR 0089 for Period 1. Keep ADR 0092 for later periods: paid, started and no Blocking Fulfilment Complaint.
- Record payouts per period and preserve the existing Owner Overpayment rule.

## Acceptance criteria

- AC1: Confirmation captures one immutable Period Owner Payable for each of six periods.
- AC2: Period 1 becomes due only under ADR 0089's Verified Access rule and when no Blocking Fulfilment Complaint is open.
- AC3: A later period becomes due only after its payment is verified, its first night has started, and no Blocking Fulfilment Complaint is open.
- AC4: An unpaid or ended period never earns its payable or margin.
- AC5: Payout records bind to one period, and a payout over that period's payable surfaces as an Owner Overpayment.
- AC6: The same owner-payable projection runs through Node and Cloudflare storage. Existing Short Stay payable tests pass unchanged.

## Validation

Create one named behavioral test per acceptance criterion, including each failure path. Run the affected Node and Worker tests. Run a real-Chrome test only if this issue changes a back-office screen.

## ADR compliance

| ADR | Constraint | Affected path / criteria |
| --- | --- | --- |
| 0089 | Capture Owner Payables at confirmation; Period 1 timing; manual payout; margin | AC1, AC2, AC5 |
| 0092 | Later Period Owner Payable timing and no payable for unpaid periods | AC1–AC4 |
| 0014 | Cancellation changes payables only through the policy result | AC4 |
| 0075 | Logs and audit records omit credentials and financial references | AC5 |
| 0095 | Tenant SQLite remains authoritative | AC6 |

## Source issues

- [Monthly-stays issue 07](../../monthly-stays/issues/07-period-owner-payable.md)

## Definition of Done

Use the repository checklist. Preserve all existing Short Stay tests unchanged. Run `npm run check` and the tests that cover this path. Record exact commands and counts in `## Comments`. Do not run the batch suites here.

## Comments

### Implementation record (22 Oct 2026)

Implementation commit: `c4b3998` (9 files, explicit paths). The tracker commit follows this record.

Files: `domains/shortlet/src/quote.ts` (BillingPeriodQuote carries `ownerPayableKobo` and `marginKobo`); `domains/shortlet/src/owner-payable.ts` (`projectOwnerPeriodPayables`, `ownerPeriodSettlementsFromQuote`, `periodIndex` on payouts and recoveries, `periodDueAt` on the projection input, `OWNER_LEDGER_PERIOD_SCHEMA` and the binding join in `SqliteOwnerPayableLedger`); `apps/cloudflare/src/schema.ts` (migration 5); `apps/cloudflare/src/do-export.ts` (binding table in the owner export group); `apps/local-owner/src/local-owner-environment.ts` (`periods` on `OperatorOwnerPayable`, `periodIndex` option on the payout and recovery recorders); `test/owner-payable-per-period.test.ts` (new, one test per AC); `test/guest-account-linking.test.ts` and `test/guest-identity-assurance.test.ts` (schema-version literal 4 to 5); `apps/cloudflare/test/platform-account-runtime.spec.ts` (legacy-upgrade simulation deletes migrations `>= 4`).

ADR table, checked against the code paths:

| ADR | Constraint | Where it is enforced | Criteria |
| --- | --- | --- | --- |
| 0089 | Owner payable captured at confirmation; Period 1 due 24h after Verified Access; margin earned when due; payouts manual and bound to a period | quote snapshot (`billingPeriods[].ownerPayableKobo`); `projectOwnerPeriodPayables` Period 1 path (existing `projectOwnerPayable`); `recordOwnerPayout` `periodIndex` | AC1, AC2, AC5 |
| 0092 | Later period due once its Period Payment is verified, its first night has begun and no complaint is open; unpaid periods have no payable; overpayment rule per booking | `projectOwnerPeriodPayables` (`periodDueAt`, unpaid branch), `earnedOwnerPayableKobo` and `marginEarnedKobo` | AC1, AC3, AC4 |
| 0014 | A cancellation changes payables only through the policy outcome | `cancellation` passed to each period's `projectOwnerPayable` (pro rata, B7 rule); unpaid periods ignore it | AC4 |
| 0075 | Owner output and audit carry no Period Payment reference or guest identity | `OwnerPeriodPayable` has no reference field; test asserts the owner view omits the session reference; binding table holds ids and numbers only | AC1, AC5 |
| 0095 | Tenant SQLite is authoritative; Node and Durable Object run the same SQL | `OWNER_LEDGER_PERIOD_SCHEMA` (also migration 5); `listPayouts` and `listRecoveries` join on `owner_ledger_period_bindings` | AC6 |
| 0105 (amended) | Demo periods follow the same payable rules; production policy unchanged | No demo gate in the owner path; nothing in ADR 0092 production limits changed | AC1 |
| 0096 | Export exemption covers four named payment-reference columns only | Binding table added to the export; it has no payment reference, so no exemption is needed | n/a |

Red-first evidence (run before any implementation, same test file):
- `NODE_ENV=test COMMERCE_REFERENCE_TEST_KEY=allow npx tsx --test test/owner-payable-per-period.test.ts`: `SyntaxError: The requested module '../domains/shortlet/src/owner-payable.js' does not provide an export named 'OWNER_LEDGER_PERIOD_SCHEMA'`; 0 of 6 tests ran.

Verification (after implementation and fixes):
- `npx tsx --test test/owner-payable-per-period.test.ts`: tests 6, pass 6, fail 0. Two fixes were made to the test file before green: AC1 needed `extendUnit` claims through checkout (the same setup as issue 10), and an AC5 expectation was corrected to the pro rata rule (a stay-level outcome shrinks every period's share, so an already-paid period 2 is over-paid by that share).
- `npm run check`: exit 0, no type errors (after the quote, owner-payable and owner-environment changes).
- Affected Node set, one consolidated run: `NODE_ENV=test COMMERCE_REFERENCE_TEST_KEY=allow npx tsx --test` over the new test, `back-office-owner-payables`, `back-office-owner-overpayment`, `back-office-dismiss-complaint`, `back-office-uphold-complaint`, `margin-pricing`, `sql-port-booking-state`, `sql-port-store-imports`, `schema-migrations`, `cutover-marker`, `export-node-sqlite`, `pay-each-demo-billing-period`, `demo-extended-stay`, `demo-extended-stay-180`, `demo-extended-assistant`, `paystack-pilot`, `integrate-card-payment-application`, `pay-by-card-and-form-one-booking-contract`, `booking-finalization-integrity`, `integrate-security-deposit-payment`, `guest-process-restart`, `pilot-database-handle`, `expire-transfer-and-refund-late-payment`, `back-office-manual-transfers`, `back-office-reservation`, `demo-public-exception-adr`, `guest-identity-assurance`, `guest-account-linking`, `commerce-schema-guard`: tests 301, pass 301, fail 0.
  - An earlier run of the wider set had 2 failures in `guest-account-linking` and `guest-identity-assurance`. Both asserted `SHORTLET_SCHEMA_VERSION === 4`, which migration 5 changes. Both literals were updated to 5, and the two files then passed (86 of 86).
- Affected Worker specs: `NODE_ENV=test COMMERCE_REFERENCE_TEST_KEY=allow npm run test:workers -- apps/cloudflare/test/daily-export.spec.ts apps/cloudflare/test/data-migration.spec.ts apps/cloudflare/test/demo-extended-stay.spec.ts apps/cloudflare/test/restore-from-export.spec.ts`: 4 files, tests 43, pass 43.
- `... -- apps/cloudflare/test/platform-account-runtime.spec.ts`: the first run failed (1 of 2) with "schema_migrations record has a gap". The spec deleted only migration 4 from a store that now also has 5. The spec now deletes migrations `>= 4`. Rerun: 1 file, tests 2, pass 2.
- Not run here, by scope: full `npm test`, full `npm run test:workers`, real-Chrome suites. No screen changed, so no captures under `screenshots/11/`.

Definition of Done:
- [x] **Every AC has a dedicated named test.** AC1 to AC6 are one `test()` each, named to mirror the criteria.
- [x] **Failure paths.** AC2: no Verified Access, inside the 24-hour window, complaint open. AC3: paid before its first night, unpaid after its start, complaint open. AC4: unpaid after its start, ended by a cancellation with nothing retained. AC5: reference reused on another period (`reference_used`), payout over the period's due (`exceeds_due`), recovery with nothing over-paid (`not_overpaid`). AC6: reopening the ledger and re-applying the migration. AC1 has no named failure path; the captured snapshot is asserted as complete and immutable.
- [x] **ADRs.** Every ADR in the table above was read and is cited at its callsite.
- [x] **No unused injected dependency.** `periodDueAt`, `recoveries`, `complaintResolvedAt`, `periodIndex` and `paidAt` are each read in the projection or the recorders.
- [x] **No invented policy.** The 24-hour window (ADR 0089 via `ownerPayableDueAt`), first night at 00:00 UTC of check-in (as `period-payment.ts` defines a period's start), and a reference unique per booking (the existing `UNIQUE (reservation_id, reference)`) are all sourced. Open: see deviation 4.
- [x] **No credential or restricted identity in audit or logs.** Audit is unchanged (ids and amount). The binding table holds only ledger ids, a reservation id and a period number.
- [x] **`npm run check` and the issue's tests pass.** Commands and counts above.

Deviations, risks and decisions needed:
1. **No back-office screen change.** The Payouts page still shows one row per booking, showing Period 1. Later periods' payables are in the owner environment (`OperatorOwnerPayable.periods`) but are not rendered, and the payout and recovery POST routes do not send `periodIndex`, so the form records Period 1. A later period cannot yet be paid from the screen. Owner decision needed on the layout; a screen change needs captures under `screenshots/11/`.
2. **Overpayment wording.** ADR 0092 says the Owner Overpayment rule applies per booking. AC5 requires it per period. Implemented per period, and the booking `payable` shows only Period 1. Counsel or owner should confirm whether the booking total should also surface it.
3. **Cancellation allocation.** A stay-level outcome shrinks each period's share pro rata (B7 rule applied per period). The per-period allocation of a cancellation, including ADR 0092 "later periods are never charged before check-in", belongs to issue 13. Unpaid periods ignore the outcome.
4. **Period tables not in the export.** The new binding table is exported (ids and numbers only). The period payment tables from issue 10 are still not exported (its deviation 3). A restore from the daily export would keep the payouts and lose the period payments that justify them. Owner or counsel decision before restore is relied on.
5. **Schema version.** `SHORTLET_SCHEMA_VERSION` is now 5. An export at version 4 needs migration before import (assertSchemaCurrent). Deploy order matters.
6. **Worker coverage.** AC6 is proven on Node SQLite and the Worker specs pass, including migrations. No Worker test reads the per-period projection through the Durable Object.
7. **Trailer.** The commit ends with Co-Authored-By: Claude Sonnet 5.5, as the operating rules require.

## Answer

Issue 11 is resolved. Each Billing Period of an Extended Stay now has its own owner payable and margin, captured in the quote snapshot at confirmation. Period 1 and later periods become due by their own rules, unpaid periods earn nothing, and payouts and recoveries bind to one period. Tests: test/owner-payable-per-period.test.ts (6 of 6); the affected Node set (301 of 301) and affected Worker specs (43 of 43, plus 2 of 2) pass. The open items are the back-office screen for later periods, the per-booking wording of the overpayment rule, the cancellation split (issue 13), and whether the period payment tables enter the export.
