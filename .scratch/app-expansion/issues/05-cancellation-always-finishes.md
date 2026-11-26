# A half-done cancellation is always finished

Status: resolved
Type: task
Blocked by: 03, 04 (D4 accepted 25 Nov 2026)

## Defect (latent)

`CancellationApplication` moves the Reservation to `cancelled` first, then posts the ledger, releases dates and starts refunds. A failure leaves the case part-done. The class has no resume, the case store is in memory, a failed ledger stops everything after it, and the guest has no action (rules 01 P1, P4, trial B).

## What to build (D4)

- A durable cancellation case store (SQLite, with its migration and export entry), replacing the in-memory default in every composition.
- A resume operation for staff or the system: idempotent, running only the unfinished steps. A failed step never prevents an independent one, so a failed ledger post must not stop the date release or the recorded refund.
- The refund becomes a recorded obligation with the exact amount and source, paid by staff and closed with the provider's refund reference, following `recordGuestRefund` and the existing Operator home item. No provider refund call (pilot policy).
- A read model the guest screen can show: cancelled; dates; each refund's state.

## Acceptance criteria

- AC1: For every combination of one failure in ledger, dates, stay refund and deposit refund, resuming reaches: ledger posted, dates released, and each refund settled or an open staff item.
- AC2: Resuming a finished case changes nothing and calls no port.
- AC3: Two resumes at once release the dates once and record each refund once.
- AC4: The sum of refunds never exceeds the sum paid, and the deposit is never added to the stay refund.
- AC5: The case survives a restart and is in the daily export.
- AC6: A guest of another Reservation, a missing tenant, and a guest calling resume are refused.
- AC7: With the resume removed, AC1 fails (recorded in Comments).

## ADR compliance

0016, 0045, 0058, 0072, 0075, 0089, 0095, 0096; `docs/policy/shortlet-pilot-payments.md`.

## Comments

### ADR & Policy Compliance

| ADR / Policy | Constraint imposed | Affected code / AC |
| --- | --- | --- |
| 0016 | Keep stay refund and security deposit refund separate; enforce money conservation (`stay <= stayPaid`, `deposit <= depositCollected`, `stay + deposit <= totalPaid`) and post ledger cancellation split cleanly | `CancellationApplication.#authoritativeObligations`, `#resumeCase`, AC1, AC4 |
| 0045 | Refund execution must never exceed authoritative paid amounts; keep ledger and obligation amounts authoritative | `CancellationApplication.#authoritativeObligations`, `test/integrate-cancellation-application.test.ts`, AC4 |
| 0058 | Security deposit is handled on a distinct track from stay refund | `CancellationCase.depositRefundStatus`, `recordedDepositRefundPort`, AC1, AC4 |
| 0072 | Versioned SQLite migrations and complete daily export table coverage | `apps/cloudflare/src/schema.ts` (v6), `apps/cloudflare/src/do-export.ts` (`cancellation_cases`), AC5 |
| 0075 | Persist no raw payment refs, guest contact details, or credentials in `cancellation_cases` | `CANCELLATION_CASES_SCHEMA`, `SqliteCancellationCaseRepository`, AC5 |
| 0089 | Cancellation completion effects execute in domain/application boundary with idempotent continuation | `CancellationApplication.resumeCancellation`, `getArtifact` D4 retry, AC1, AC2 |
| 0095 | Authorized tenant-scoped access for guest artifacts and staff resume; fail closed on wrong guest/tenant or non-staff resume | `CancellationApplication.getArtifact`, `resumeCancellation`, AC6 |
| 0096 | Audit cancellation completion outcomes (`cancellation.committed`, `no_show.confirmed`) without leaking secrets | `CancellationApplication.#complete`, AC1 |
| `docs/policy/shortlet-pilot-payments.md` | Pilot policy: no Paystack Refund API call; cancellation refunds become recorded obligations on Operator Home until staff record Paystack refund ref (`D4`, `D28 P2`) | `recordedCancellationRefundPort`, `recordedDepositRefundPort`, `LocalApartmentOwnerEnvironment.listGuestRefundsOwed`, `recordGuestRefund`, AC1 |

### Implementation Notes

- Added durable `SqliteCancellationCaseRepository` and `InMemoryCancellationCaseRepository` in `domains/shortlet/src/cancellation-case-store.ts` (exported via `domains/shortlet/src/index.ts`) with SQLite table `cancellation_cases`, SQL compare-and-swap on `case_version`, and per-DB in-flight concurrency guard `tryAcquireResumeGuard`.
- Added migration v6 (`SHORTLET_SCHEMA_VERSION = 6`) in `apps/cloudflare/src/schema.ts`, added `"cancellation_cases"` to `SHORTLET_EXPORT_TABLES` in `apps/cloudflare/src/do-export.ts`, and wired `cancellationCases` into `apps/local-guest/src/fixture.ts` and `test/helpers/booking-state-fixture.ts`.
- Updated `CancellationApplication` (`apps/web/src/cancellation-application.ts`) and `CancellationArtifact` (`apps/web/src/cancellation-artifact.ts`) to run ledger, inventory release, stay refund, and deposit refund independently, retry unfinished ledger/release on `getArtifact`, expose `resumeCancellation` for staff, enforce money conservation and deposit separation (`#authoritativeObligations`), and expose guest read-model `dates` + `refunds: { stay, deposit }`.
- Wired `recordedCancellationRefundPort`, `recordedDepositRefundPort`, and `cancellationCases` into `LocalApartmentOwnerEnvironment` (`apps/local-owner/src/local-owner-environment.ts`) and `local-owner-server.ts` so recorded obligations surface on Operator Home (`listGuestRefundsOwed`) until settled via `recordGuestRefund`.
- Updated `docs/agents/state-machines.md` with the `CancellationCase` row.

### Mutation Check (AC7)

- **Red baseline (before fix):** `npx tsx --test test/after-booking-exploration.test.ts` -> `2 pass, 1 fail` (`AC1 (issue 05)` failed `15 !== 0` across `16` combinations).
- **Mutation (resume disabled):** Temporarily commented out `this.#resumeCase` in `CancellationApplication.resumeCancellation` and the D4 read-time retry in `getArtifact`: `npx tsx --test test/after-booking-exploration.test.ts` -> `2 pass, 1 fail` (`AC1 (issue 05)` failed `15 !== 0` out of `16` explored combinations).
- **Restore verified:** Removed temporary comments and re-ran `npm run check && npx tsx --test test/after-booking-exploration.test.ts` -> `3/3 passed, 0 failed` (`28` explored for Check A / `16` explored for Check B, `0` violations).

### Verification

- `npm run check`: passed (0 errors across root, `apps/cloudflare`, `tsconfig.test.json`, `tsconfig.tooling.json`, and `node scripts/check-worker-bundle.mjs`).
- `npx tsx --test test/after-booking-exploration.test.ts test/cancellation-always-finishes.test.ts test/cancelled-accepts-no-change.test.ts test/integrate-cancellation-application.test.ts test/render-cancellation-weaver-a2ui.test.ts test/demo-extended-cancellation-notice.test.ts test/back-office-uphold-complaint.test.ts test/schema-migrations.test.ts test/export-node-sqlite.test.ts test/state-machine-inventory.test.ts`: `90/90 passed, 0 failed`.
- `npm run test:workers -- test/daily-export.spec.ts test/data-migration.spec.ts test/production-composition.spec.ts test/restore-from-export.spec.ts`: `48 passed (4 files: production-composition.spec.ts 3, restore-from-export.spec.ts 4, data-migration.spec.ts 29, daily-export.spec.ts 12)`.
- Post-mutation restore check: `npm run check && npx tsx --test test/after-booking-exploration.test.ts` -> `3/3 passed, 0 failed`.

### Definition of Done Checklist

- Every acceptance criterion (AC1–AC7) has passing tests in `test/after-booking-exploration.test.ts` and `test/cancellation-always-finishes.test.ts`.
- All listed ADRs (`0016`, `0045`, `0058`, `0072`, `0075`, `0089`, `0095`, `0096`) and `docs/policy/shortlet-pilot-payments.md` checked and satisfied.
- `npm run check`, affected Node tests, and affected Cloudflare Worker specs pass cleanly with exact commands and counts recorded above.
- `docs/agents/state-machines.md` updated in the same commit (`test/state-machine-inventory.test.ts` passes).

