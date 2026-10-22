# Wire a 30-night demo Extended Stay through booking and payment

Status: resolved
Type: AFK
Blocked by: 04

## Parent

[Public Live Demo Launch PRD](../PRD.md)

## Why

Issue 05 now needs monthly prices and unit terms. The current application has no Extended Stay quote or payment-period runtime. Start with one complete 30-night journey before extending it to six periods.

## What to build

- Add versioned Monthly Agreed Amounts and a structured utilities/servicing statement to the Unit. Use ADR 0092 and the existing `UnitOwnerTerms` margin model.
- Add the 30-night Extended Stay quote, Request to Book, offer, first Period Payment, and confirmed contract for demo mode.
- Use the existing payment gateway and server-side verification. Tests use stubbed Paystack TEST responses; they never create a live transaction. A verified first Period Payment confirms the stay and blocks its dates through the existing command path.
- Wire both the Node local pilot and the Cloudflare Durable Object repositories. Tests must exercise those compositions and the authenticated `/_ops` import path.
- Gate demo-only behavior on authoritative configuration. Require the existing Cloudflare Access JWT and `OPS_SHARED_SECRET` for every `/_ops` request.
- Keep the public Worker unavailable when required demo inventory is absent. Keep production demo refusal in force.

## Acceptance criteria

- AC1: An authenticated operator import creates one opted-in synthetic Unit with Monthly Agreed Amounts and a utilities statement. Missing or wrong credentials import nothing.
- AC2: A 30-night quote uses the Monthly Agreed Amounts plus margin, and carries the amount, utilities and Billing Period values into the Request to Book.
- AC3: A valid verified test-mode first Period Payment confirms one 30-night booking once and blocks all 30 nights.
- AC4: A missing, invalid, mismatched or superseded provider verification confirms nothing and marks no payment successful.
- AC5: An unverified Period Payment releases its hold at the Payment Window deadline, without confirming a booking.
- AC6: The same 30-night journey works through the Node local pilot and Cloudflare Durable Object storage, including restart recovery.
- AC7: Demo booking behavior is refused in production and when demo mode is disabled. Existing Short Stay tests pass unchanged.

## Validation

Create one named behavioral test per acceptance criterion, including each failure path. Use stubbed Paystack TEST responses. Run only the affected Node, Worker and real-Chrome tests. Do not create live transactions or use production credentials.

## ADR compliance

| ADR | Constraint | Affected path / criteria |
| --- | --- | --- |
| 0005, 0072, 0080 | Request to Book, confirmation and payment remain on the authorized command path | AC2–AC4 |
| 0015, 0089, 0092 | All-in pricing, Monthly Agreed Amounts, margin and a 30-night Billing Period | AC2–AC3 |
| 0075 | No secrets or guest identity data in logs or audit records | AC1, AC4 |
| 0087 | Staging uses server-verified Paystack test payments | AC3–AC4 |
| 0095 | Cloudflare Durable Object SQLite remains authoritative | AC5 |
| 0105 | Demo behavior is staging-only and uses synthetic units | AC1, AC6 |

## Source issues

- [Monthly-stays issue 04](../../monthly-stays/issues/04-extended-stay-eligibility.md)
- [Monthly-stays issue 05](../../monthly-stays/issues/05-monthly-price-and-utilities.md)
- [Monthly-stays issue 06](../../monthly-stays/issues/06-billing-periods-and-period-payments.md)

## Definition of Done

Use the repository checklist. Preserve all existing Short Stay tests unchanged. Run `npm run check` and the tests that cover this path. Record exact commands and counts in `## Comments`. Do not run the batch suites here.

## Comments

### Implementation plan and ADR constraints (22 Oct 2026)

| ADR | Constraint | Acceptance criterion / code path |
|---|---|---|
| 0005, 0072, 0080 | Keep Request to Book, confirmation, and payment on the authenticated command path. | AC2–AC4: quote, disclosure, operator offer, payment verification, and contract formation. |
| 0009, 0055, 0056, 0057, 0065 | Recheck unit, inspection, authority, regulatory, and horizon validity through checkout. | AC1–AC3 and AC6: import/provision, eligibility, request, offer, payment initialization, contract formation. |
| 0015, 0089, 0092 | Price from versioned Monthly Agreed Amounts plus margin; capture period and utilities terms. | AC1–AC3 and AC6: unit model, quote snapshot, request, offer, and contract. |
| 0075 | Exclude credentials, guest identity data, and payment references from logs and audit records. | AC1 and AC4: authenticated import and verification/audit paths. |
| 0087 | Use server-side Paystack TEST verification with amount and currency checks. | AC3–AC5: first Period Payment, verification failures, and deadline expiry. |
| 0095 | Keep Durable Object SQLite authoritative and recoverable after restart. | AC5–AC6: Worker composition and persisted quote, request, payment, and contract state. |
| 0105 | Permit this behavior only for synthetic units in staging demo mode; production and disabled demo refuse it. | AC1, AC6, and AC7: importer, authoritative runtime policy, and composed configuration checks. |

Implementation sequence: extend versioned Unit terms and CSV import; add scoped Extended Stay policy and quote snapshots; compose Node and Worker routes; add fail-closed tests; run focused checks; review Definition of Done; commit; then resolve this issue and update the map.

### Completion evidence and Definition of Done (22 Oct 2026)

AC1 passes authenticated synthetic import, invalid credential, malformed row, explicit opt-out, and real SQLite transaction rollback checks. The rollback case uses SQLite Unit and Operator repositories on the same database.

AC2 passes exact Monthly Agreed Amounts plus margin arithmetic, utilities and one Billing Period snapshots, quote immutability, and discovery amount checks. Discovery now shows zero Extended Stay deposit while Short Stay retains its configured deposit.

AC3 passes stubbed Paystack TEST verification, one confirmed 30-night contract, duplicate verification idempotency, and all 30 calendar blocks.

AC4 passes missing, provider failure, invalid, mismatched amount, mismatched reference, and truly superseded persisted-attempt cases. Invalid verification creates no contract. Superseded successful money enters reconciliation.

AC5 passes Payment Window expiry behavior. Unverified payment releases the hold at the deadline and confirms no contract.

AC6 passes Node SQLite restart composition and the real Worker HTTP journey. The Worker imports through authenticated ops, creates a Request to Book, accepts an offer, initializes stubbed Paystack TEST checkout, survives `abortAllDurableObjects`, verifies a callback, and handles a duplicate callback idempotently.

AC7 passes staging hardened composition and demo-disabled and production refusal checks. The regular ops bootstrap remains independent of guest payment configuration.

Test-first protocol deviation: runtime work started before every AC had its dedicated test. After review found this gap, implementation stopped while dedicated tests were added. I do not claim those tests ran red against starting commit `7362945`.

The final Node command passed 133 tests across the issue, assistant tool, browse, import, booking, offer, card, Paystack, late-payment, and browser-restart paths:

`$env:NODE_ENV='test'; $env:COMMERCE_REFERENCE_TEST_KEY='allow'; npx tsx --test test/demo-extended-stay.test.ts test/demo-extended-assistant.test.ts test/browse-one-eligible-unit.test.ts test/inventory-import.test.ts test/integrate-booking-request-application.test.ts test/integrate-conditional-offer-application.test.ts test/integrate-card-payment-application.test.ts test/paystack-pilot.test.ts test/expire-transfer-and-refund-late-payment.test.ts test/guest-browser-restart.test.ts`

The focused Node pilot and restart command passed 49 tests:

`$env:NODE_ENV='test'; $env:COMMERCE_REFERENCE_TEST_KEY='allow'; npx tsx --test test/pilot-production-composition.test.ts test/pilot-database-handle.test.ts test/pilot-guardrails.test.ts test/guest-process-restart.test.ts`

The focused Worker composition command passed 21 tests across six specs:

`$env:NODE_ENV='test'; $env:COMMERCE_REFERENCE_TEST_KEY='allow'; npm run test:workers -- apps/cloudflare/test/demo-extended-stay.spec.ts apps/cloudflare/test/ops-restore.spec.ts apps/cloudflare/test/shortlet-ops-commerce-isolation.spec.ts apps/cloudflare/test/cloudflare-config.spec.ts apps/cloudflare/test/production-composition.spec.ts apps/cloudflare/test/pilot-worker.spec.ts`

After the discovery deposit correction, the actual demo Worker spec passed 2 tests:

`$env:NODE_ENV='test'; $env:COMMERCE_REFERENCE_TEST_KEY='allow'; npm run test:workers -- apps/cloudflare/test/demo-extended-stay.spec.ts`

`npm run check` passed. The Workers bundle guard found no Node SQLite adapter in the Worker graph.

The capture command produced 32 screenshots for discovery, unit detail, Request Draft, and duration refusal. Each screen uses widths 320, 390, 768, and 1280 in light and dark themes. Overflow and 44px target checks found no issues. See `.scratch/demo-launch/screenshots/08/findings.txt`.

Definition of Done checklist:

- [x] AC1–AC7 each have named behavioral tests and their listed failure cases.
- [x] Relevant ADRs are listed in the implementation table and this issue's ADR compliance table.
- [x] No unused injected dependency was added.
- [x] Extended Stay limits come from the scoped staging policy. Monthly terms and margin use ADR 0092.
- [x] Audit records and logs exclude credentials, payment references, and restricted guest identity data.
- [x] The staged guest screens use existing components and pass responsive overflow and target-size checks.
- [x] `npm run check`, the focused Node suites, the focused Worker suites, and captures pass. No full batch suite ran.

No live payment transaction, production deployment, or issue09 work was performed.

### Review and commit record (22 Oct 2026, executor re-run)

Implementation commit: `60cae4a` (65 files, explicit paths only). Scope: `domains/shortlet/src` issue files, `apps/cloudflare/src` (ops-routes, shortlet-pilot-do, test-worker), `apps/local-guest/src` and `apps/local-owner`/`apps/pilot`/`apps/web` composition, `apps/cloudflare/wrangler.test.jsonc`, the two Worker/Node issue spec files, the two Node issue test files, the capture script, and `screenshots/08/`.

Excluded because they are not issue 08: `test/guest-must-fix-ux.test.ts` (existing test changed from a 503 to a 401 failure, weakening its provider-outage case; flagged for its owner), the `temporaryDatabasePath` refactor across existing tests and `test/helpers/temporary-database.ts`, the `back-office-*` assertion helper edits and untracked `test/back-office-payment-privacy.test.ts`, the Chrome termination hunk in `test/helpers/chrome-devtools.ts` and `test/browser-attach.test.ts`, `apps/local-guest/dist/*`, and `apps/cloudflare/public/_headers`. The issue 08 tests do not import any excluded file.

Re-run in the working tree (foreground, `NODE_ENV=test`, `COMMERCE_REFERENCE_TEST_KEY=allow`):
- `npm run check`: passed, zero type errors; Worker bundle guard passed.
- Node issue set (same ten files as above): 133 pass, 0 fail.
- Node pilot and restart set: 49 pass, 0 fail.
- Worker set, six specs: 21 pass in 6 files, 0 fail.
- Captures: `screenshots/08/` holds 32 PNG files; `findings.txt` reports no horizontal overflow and no controls below 44px.

Test-first deviation: as recorded above, runtime work preceded some dedicated tests, so the red-first run is not claimed.

Known risks: the tests ran against the dirty tree, so the committed subset was not run on a clean HEAD. `DEMO_EXTENDED_STAY_POLICY` (30/30 nights) is a scoped staging constant; ADR 0092 sets production at 30-90 nights, and issue 09 extends the demo policy.

## Answer

Issue 08 is resolved. The staging-only 30-night path now uses one immutable Billing Period quote, scoped policy checks, verified test payments, and durable Node and Cloudflare storage. Issue 09 remains the next implementation step.
