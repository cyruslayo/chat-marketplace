# Demo monthly cancellation, Notice to End and overdue handling

Status: resolved
Type: AFK
Blocked by: 09, 10, 11

## Parent

[Public Live Demo Launch PRD](../PRD.md)

## Why

An Extended Stay demo must explain changes and missed period payments. ADR 0092 contains numeric cancellation and Notice to End terms, but marks them as awaiting counsel approval.

## What to build

- Demonstrate only the existing ADR 0092 values for synthetic staging demo bookings. Identify the guest-facing values as demo terms. This exception does not close the counsel gate.
- Use the cancellation and amendment services, booking snapshots and period payment state. Do not add a second refund or adjustment model.
- Keep cancellation and early-departure decisions deterministic. Model output may explain results only.
- Project overdue Period Payment state from the clock. Direct the case to human contact. Never lock out the guest, change access, or run an end-of-stay process; the lawful process remains [counsel].
- Keep Short Stay cancellation behavior unchanged.

## Acceptance criteria

- AC1: Before check-in, a demo Extended Stay cancellation applies ADR 0092's T-30/T-14 values to the first Period Payment and never charges unpaid later periods.
- AC2: The cancellation entry is snapshotted at request and contract creation, so a later catalogue change does not change an existing booking.
- AC3: A 14-day Notice to End records a versioned Booking Amendment, sets the last night from the notice date, settles only through that date, and refunds paid nights after it at the contract's nightly values.
- AC4: Operator, platform or safety failure uses ADR 0061's remedy path and never falls through to the voluntary Notice to End rules.
- AC5: A missed due date projects an overdue state and requests human contact. It never changes access or automatically ends the stay.
- AC6: The guest sees demo wording for the cancellation and Notice to End values. The screen does not state or imply that counsel approved them.
- AC7: Existing Short Stay cancellation and Notice to End tests pass unchanged. Named tests cover every criterion and failure path.

## ADR compliance

| ADR | Constraint | Affected path / criteria |
| --- | --- | --- |
| 0014, 0058 | Versioned cancellation catalogue and deterministic result | AC1–AC2 |
| 0060 | Booking Amendments are versioned and atomic | AC3 |
| 0061 | Failure remedies override voluntary departure | AC4 |
| 0075 | Keep credentials and restricted identity data out of output and logs | AC1–AC7 |
| 0092 | T-30/T-14 demo cancellation, 14-day Notice to End, overdue handling; lawful termination remains counsel-gated | AC1–AC5 |
| 0105 | Synthetic staging demo may demonstrate ADR 0092 values with clear demo wording | AC6 |

## Source issues

- [Monthly-stays issue 08](../../monthly-stays/issues/08-cancellation-and-notice-to-end.md)
- [Monthly-stays issue 06](../../monthly-stays/issues/06-billing-periods-and-period-payments.md)

## Definition of Done

Use the repository checklist. Preserve all existing Short Stay tests unchanged. Run `npm run check` and the tests that cover this path. Record exact commands and counts in `## Comments`. Do not run the batch suites here.

## Comments

### Implementation (commit 8312ab7)

Status is left at `ready-for-agent`. The acceptance evidence below is complete for AC1, AC2, AC4, AC5 and AC7, and partly complete for AC3 and AC6 (open items 1 and 2). The Definition of Done is not ticked as a whole until those are decided.

**ADR table (read: ADR 0014, 0058, 0060, 0061, 0075, 0092, 0105; list of `docs/adr/` checked)**

| ADR | Constraint | Code path / criterion |
| --- | --- | --- |
| 0014, 0058 | Versioned catalogue; deterministic result; base is nightly accommodation and mandatory charges | `extended-stay.ts` (entry constants), `cancellation-noshow.ts` (`extended` type, T-30d/T-14d), `extended-stay-changes.ts` `extendedCancellationEconomics` (AC1, AC2) |
| 0060 | Versioned, atomic amendment; original stays authoritative until commit | `NoticeToEndManager.giveNotice` single `mutateContract` at the expected version, `contract.noticeToEnd` marker (AC3) |
| 0061 | Failure remedy overrides voluntary departure | `giveNotice` refuses on `failures.hasOpenFailure` before any amendment or refund (AC4) |
| 0075 | No credentials or restricted identity in output or logs | No audit record added. Payment references are passed only to the refund port (AC1–AC7) |
| 0092 | T-30/T-14; 14-day Notice to End; later periods never charged before check-in; overdue handling | AC1–AC5 (see Assumptions) |
| 0105 | Demo may show ADR 0092 values, labelled as demo terms | `EXTENDED_CANCELLATION_DEMO_SUMMARY`, `NOTICE_TO_END_DEMO_TERMS`; `giveNotice` refuses without the demo `extendedStayPolicy` (AC6, production gate) |

**Red first.** Test file written before implementation.
- `NODE_ENV=test COMMERCE_REFERENCE_TEST_KEY=allow npx tsx --test test/demo-extended-cancellation-notice.test.ts` gave `ERR_MODULE_NOT_FOUND` for `domains/shortlet/src/extended-stay-changes.js`. The file loaded 0 tests.
- The first green run after implementation gave 20 pass, 1 fail. The failure was a wrong field name in the test (`policy.summary` instead of `policySummary`). After the fix: 21 of 21. A named projection test was added for the Notice to End period cut-off, giving 22 of 22.

**Commands and counts (final)**
- `npm run check`: exit 0, zero type errors (run after every change; final run after the period filter).
- `NODE_ENV=test COMMERCE_REFERENCE_TEST_KEY=allow npx tsx --test test/demo-extended-cancellation-notice.test.ts`: 22 of 22 pass (AC1 5, AC2 1, AC3 10, AC4 1, AC5 2, AC6 1, AC7 1 for the named criteria, and one additional AC3 projection test).
- Affected set, same environment, one `tsx --test` process: `test/demo-extended-stay.test.ts`, `test/demo-extended-stay-180.test.ts`, `test/pay-each-demo-billing-period.test.ts`, `test/owner-payable-per-period.test.ts`, `test/integrate-cancellation-application.test.ts`, `test/cancel-and-determine-no-show.test.ts`, `test/integrate-booking-amendment-application.test.ts`, `test/amend-material-booking-terms.test.ts`, `test/integrate-booking-contract-application.test.ts`, `test/integrate-card-payment-application.test.ts`, `test/back-office-owner-payables.test.ts`, `test/back-office-owner-overpayment.test.ts`, plus the new file: 86 of 86 pass. The Short Stay tests (`cancel-and-determine-no-show`, `integrate-cancellation-application`, `integrate-booking-amendment-application`, `amend-material-booking-terms`) were not edited.
- Worker: `npm run test:workers -- apps/cloudflare/test/demo-extended-stay.spec.ts`: 2 of 2 pass (run before the period cut-off change; that change acts only after a Notice to End, which the Worker does not reach).
- Capture: `npx tsx .scratch/demo-launch/capture-13-demo-surfaces.ts` (copy of the issue 08 script, output `screenshots/13`): layout checks passed. `screenshots/13/findings.txt`: "No horizontal overflow or controls below 44px." 32 PNGs at 320, 390, 768 and 1280, light and dark. Viewed the 390 light request draft.
- Not run: full `npm test` and batch `npm run test:workers` (batch gate only).

**Definition of Done (checked)**
1. Every AC has named tests, one `test()` per criterion prefix: yes, in `test/demo-extended-cancellation-notice.test.ts`.
2. Failure paths asserted: AC1 later-paid fail-closed; AC3 no verified access, second notice, non-primary guest, Short Stay, production gate; AC4 failure refusal with no amendment and no refund; AC5 no change on overdue.
3. ADRs listed and read: yes (table above).
4. No unused injected dependency: `NoticeToEndManager` uses contracts, periods, arrival, failures, refunds, extendedStayPolicy and clock.
5. No invented policy string: the thresholds, the 14-day notice and the cancellation base come from ADR 0092, ADR 0058 and ADR 0014. Two strings are labels I wrote and need owner approval: the version `cancellation-extended-adr0092-v1` and the demo summary text.
6. No bearer credential or restricted identity in audit or logs: no audit record added; references go only to the refund port.
7. `npm run check` clean, and the issue and affected tests pass: see counts above.

**Assumptions carried over (recorded, production policy unchanged)**
- Issue 10 interpretations, as implemented in `period-payment.ts`: a later period is unpayable once its first night begins (`initializePeriodCheckout`); overdue from the start of the due date (`projectPeriods`); the payment window is capped at the first night (`Math.min` in session start); reminders stop on the due date (`remindersDue`). These await owner and counsel decision. Nothing changed to production.
- Issue 11 cancellation allocation: the pre-check-in base is Period 1 only, so unpaid later periods are never charged (AC1). A paid later period fails closed. Notice refunds are keyed by amendment and period; an amendment commits once; a second notice is refused. No double refunds, no refund of unpaid periods, and no Owner Payable for unpaid periods (the owner share is computed from the period's own settlement).

**Open items and deviations (decision needed)**
1. AC6, Notice to End wording: `NOTICE_TO_END_DEMO_TERMS` is returned in the command result only. No guest route or screen renders the notice (none exists in the repo). The cancellation demo wording does reach the guest through the existing quote summary, shown on the request draft capture, which sits below the fold at 390px. A Notice to End screen would need a guest UI change and its own captures.
2. AC3, Owner Payables: the notice returns the recalculated `ownerPayables` for each period. They are not written to the owner ledger, the period payable projection or the back-office screen. Persisting them needs a ledger write path that this issue does not add.
3. AC3, refunds: the refund port is injected. No production composition in the repo wires it, which matches issues 08–11. A refund that throws is recorded as `reconciliation_required` and is not retried automatically.
4. The notice does not rewrite the quote snapshot. The contract's dates and `noticeToEnd` change, and the period projection drops periods that start on or after the new checkout. A final period cut short by the notice keeps its original amount in the projection. That is a known gap.
5. ADR 0061: a notice is refused while a failure is open. The ADR 0061 remedy calculation (`calculateAuthoritativeRemedy`) is not invoked by this issue; the existing mid-stay incident path handles the failure.
6. Notice effective date: the WAT date is `now + 1 hour` with no DST, consistent with Lagos.
7. The cancellation base is the Period 1 owner payable plus margin (guest accommodation and mandatory charges, ADR 0058). The Period 1 amount minus that base is treated as attributable tax, refundable in full.

### Round 2 (commit 9c3b55f): open items 1, 2 and 4 closed; captures still open

- Item 1 (AC6), Notice to End wording: the booking contract artifact carries `noticeToEndTerms` for an Extended Stay. The chat contract (`booking-contract-a2ui.ts`) and the confirmation page (`confirmation-presentation.ts`) show it as "Notice to End: ..." next to the cancellation terms. Tests: "AC6: The guest booking contract shows the Notice to End demo terms in chat and on the confirmation page" and "AC6: The guest contract wording never claims counsel approval ...".
- Item 2 (AC3), owner payable: `SqliteOwnerPayableLedger.recordPeriodNoticeAdjustment` writes one row per reservation and period (`owner_period_notice_adjustments`, created with the issue 11 period schema). An identical row is a replay (`replayed: true`); a different row for the same period is refused. Unpaid periods write nothing. The projection (`projectOwnerPeriodPayables`, `noticeAdjustments`) replaces a period's settlement once. `NoticeToEndManager` requires the ledger (`owners`) and records after the amendment commits. Tests: four AC3 ledger tests, including replay and conflict.
- Item 4, cut-short period: a Billing Period that straddles the amended checkout projects only its kept nights, with `checkOut` at the new checkout and the kept amount (the sum of its nightly values). A new payment session for it is refused ("cut short by a Notice to End"). Tests: "A Billing Period cut short by a Notice to End projects only the nights kept" and "... cannot start a new payment session".

Commands and counts (round 2):
- Red first: `NODE_ENV=test COMMERCE_REFERENCE_TEST_KEY=allow npx tsx --test test/demo-extended-cancellation-notice.test.ts` before the implementation: 30 tests, 22 pass, 8 fail. The 8 failures are exactly the new round-2 tests (4 ledger, 2 cut-short, 2 wording), which call methods and fields that did not exist yet.
- Green: the same file, 30 of 30 pass.
- `npm run check`: exit 0.
- Affected set, one process, 17 files (the 13 from round 1 plus `guest-confirmation-system`, `render-booking-contract-weaver-a2ui`, `sql-port-booking-state`, `sql-port-store-imports`): 106 tests, 105 pass, 1 fail. The failing test was `back-office-owner-overpayment` AC4, with `fetch failed` inside the operator sign-in helper while many files ran in parallel. The file re-run alone gave 5 of 5 pass (`npx tsx --test test/back-office-owner-overpayment.test.ts`). Treat this as a parallel-load flake, recorded rather than hidden.
- Worker: `npm run test:workers -- apps/cloudflare/test/demo-extended-stay.spec.ts`: 2 of 2 pass.

Still open, which keeps this issue `ready-for-agent`:
- Captures for the changed contract and confirmation screen are not in `screenshots/13/`. The round 1 captures cover only the request draft and discovery, and the contract screen is shown only after payment. The issue 08 request-draft captures predate the contract change. An attempt to drive an Extended Stay to `confirmed` through `restartFixture().advance` failed inside the chat-turn helper (`a2uiMessages` of undefined after the offer step). Producing those captures needs a payment-stage driver, and that script was not committed.
- The notice's owner-payable reductions are now persisted, but the back-office payables screen does not show them yet. That is screen work for issue 12.
- Known cross-check: the Cloudflare `SHORTLET` schema migration list does not include `owner_period_notice_adjustments`, since issue 11's period tables are also created inline in the local ledger. The daily export list is not updated.

### Round 3 (commit 4b571db): Cloudflare parity; captures still open

- Parity (AC3, owner ledger): `owner_period_notice_adjustments` is created by shared Shortlet migration 5, through `OWNER_LEDGER_PERIOD_SCHEMA`, the same statement issue 11 uses for `owner_ledger_period_bindings`. Migration 5 has not been deployed: issue 06 (the staging deploy) is still `ready-for-human`, and deployment is a hard stop in the handoffs. So migration 5 is extended and `SHORTLET_SCHEMA_VERSION` stays 5. The table is also in the owner group of `SHORTLET_EXPORT_TABLES` (`apps/cloudflare/src/do-export.ts`). Its columns are ids, period numbers and kobo amounts only.
- Commands and counts (round 3):
  - `npm run test:workers -- apps/cloudflare/test/daily-export.spec.ts apps/cloudflare/test/data-migration.spec.ts apps/cloudflare/test/restore-from-export.spec.ts apps/cloudflare/test/platform-account-runtime.spec.ts apps/cloudflare/test/demo-extended-stay.spec.ts`: 5 files, 45 of 45 pass.
  - `NODE_ENV=test COMMERCE_REFERENCE_TEST_KEY=allow npx tsx --test test/cutover-marker.test.ts test/guest-account-linking.test.ts test/guest-identity-assurance.test.ts test/owner-payable-per-period.test.ts test/demo-extended-cancellation-notice.test.ts`: 134 of 134 pass. This covers the version pins (`guest-account-linking` asserts version 5), the migration statements and the new parity test.
  - `npm run check`: exit 0.
- Capture driver diagnosis (not resolved; captures still open):
  - The driver's first turn returns only a message asking for dates. The issue 08 capture sends the stay in three turns ("…30 nights…", "10 Sep", "2 guests"). With those turns, the request is submitted and the state is a `waiting` surface with no action button. `guestAction` (test/helpers/guest-restart.ts) asserts a button, so `advance` fails there. This is the helper's manual-acceptance assumption, not a defect in my changes.
  - After `simulateOperatorAcceptance` succeeds, the next `fixture.state()` call gets `ECONNRESET`. I reproduced this at commit 71f2550, before any issue 13 change, in a temporary worktree (since removed). So it is a pre-existing defect in the demo composition's state read after operator acceptance. I did not isolate the server-side exception. The unhandled-rejection listener caught nothing, and the route handler does not respond.
  - Result: the contract and confirmation captures for an Extended Stay are not produced. Their absence keeps this issue `ready-for-agent`. The next step is to find the exception in the demo state route after the offer is issued, then drive payment to `confirmed` and capture at 320/390/768/1280.

### Round 4 (commits d35d942, 19b9653): ECONNRESET root cause, contract captures, resolution

- Root cause of the ECONNRESET on /api/state after operator acceptance: a test-driver artefact, not a demo-server defect. The helper `guestAction` asserts that a surface has an action button. A request awaiting the operator has none, so the assertion fails. Building the AssertionError message took 11.6 s of synchronous work in the test process (measured: `guestAction ms 11599`). The server's 5 s keep-alive timer closed the idle pooled socket during that time, and the next request reused it and was reset.
- Evidence: the reset happens before any change in this issue, at 71f2550 (issue 13 not yet started). The control Short Stay sequence has an action on every surface and never reaches the failing path. Replacing the throwing check with a non-throwing one removed the 11 s gap, and the state read then returned `ok: true` every time. The server logs showed a stale client socket (port 59923) reset at the moment of the read, not a server-side exception. I did not run a full commit bisect across 60cae4a..c4b3998: the failure reproduces at 71f2550, and the server code on that path is identical to this branch's.
- Fix (d35d942): additive helper `guestActionOrUndefined`. Red first: test/guest-restart-helper.test.ts failed with a missing export. Green: 3 of 3. `guestAction` is unchanged.
- Captures (19b9653): the confirmed Extended Stay driven through the real guest flow (`drive-13.ts`, stubbed provider) to `/booking-contracts/...`. Standalone contract page and chat at 320/390/768/1280, light theme, eight PNGs. Overflow and 44px checks pass inside `.confirmed-screen`, the capture-10 convention. The Notice to End wording is shown and no counsel-approval claim appears. Shell chrome outside `.confirmed-screen` (the "Back to conversation" link and "View booking details" in the workspace heading) measured under 44px in some runs. It is pre-existing and out of scope, and is recorded rather than fixed.

Resolution: every acceptance criterion has named tests, the Cloudflare parity test passes, and the contract and confirmation captures exist. The DoD items are checked as before. Open note for the owner: the cancellation version label `cancellation-extended-adr0092-v1` and the demo summary text are labels written for this issue. The thresholds and the 14-day notice trace to ADR 0092 and remain [counsel].
