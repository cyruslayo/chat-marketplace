# A cancelled Reservation accepts no change

Status: resolved
Type: task
Blocked by: 03 (D3 accepted 25 Nov 2026)

## Defect (latent: neither flow is connected for guests)

`BookingAmendmentManager` checks the contract version, calendar, inspection, authority and quote. It never reads the Reservation. Cancelling moves the Reservation without moving the contract version. So an accepted amendment can settle and commit after cancellation (rules 01 S1, trial A).

## What to build (D3)

- Give `BookingAmendmentDependencies` a required Reservation reader. Request, accept and commit refuse unless the Reservation is `confirmed`. A missing Reservation refuses (fail closed).
- Re-read it immediately before `settlementProvider.settle`, and again before the contract write.
- Cancellation closes a `proposed`, `accepted` or unpaid `awaiting_financial_settlement` amendment. Add the move to `AMENDMENT_TRANSITIONS` only if the owner names the state (no invented status).
- In-flight settlement (D3): a payment already in progress settles first and is then refunded with the stay. The refund half needs issue 05; until it lands, cancellation refuses while a settlement is in flight, with a message that says why, rather than losing the money.
- **Stop and ask** if a needed state or message has no source. The closed-by-cancellation state has no name yet.

## Acceptance criteria

- AC1: After cancellation, request, accept and commit are refused, nothing is collected and the contract version does not move. Failure paths: `no_show`, a missing Reservation, another guest's Reservation.
- AC2: The order check of issue 03 reports zero failing orders, with cancel and commit each succeeding in at least one order.
- AC3: Removing the new guard makes AC2 fail again (recorded in Comments).
- AC4: An amendment with no cancellation behaves as before (`test/amend-material-booking-terms.test.ts` keeps its assertions).
- AC5: `docs/agents/state-machines.md` names the guard.

## ADR compliance

| ADR / Decision | Constraint | Where |
| --- | --- | --- |
| 0045, D3 | In-flight amendment payment settles before refund; unpaid amendment closes with no charge; until issue 05 lands, cancellation refuses with reason when amendment settlement is in flight | `domains/shortlet/src/booking-amendment.ts` (`hasSettlementInFlight`, `closeUnpaidAmendmentsForCancellation`), `apps/web/src/cancellation-application.ts` (`#assertNoAmendmentSettlementInFlight`, `#closePendingChangesForCancellation`) |
| 0058, D29 | Once a Reservation is `cancelled` or `no_show`, no change, extension approval, Notice to End, or upheld complaint is accepted, and any waiting Extension closes to `"cancelled"` | `BookingAmendmentManager`, `ExtendedStayExtensionManager`, `NoticeToEndManager`, `CheckInSupportManager.upholdBlockingComplaintAsSupport`, `CancellationApplication` |
| 0060 | Versioned amendments use `AMENDMENT_TRANSITIONS` allow-list; owner decision A1 added `"cancelled"` (`proposed`/`accepted`/`awaiting_financial_settlement` -> `"cancelled"`, `cancelled` -> `[]`) and A2 added `"cancelled"` to `ExtensionStatus` | `domains/shortlet/src/booking-amendment.ts`, `domains/shortlet/src/extended-stay-extension.ts` |
| 0072 | Consequential actions execute through `PlatformCommandEnvelope` with server-side principal and contract/reservation authority checks | `BookingAmendmentManager`, `CheckInSupportManager`, `CancellationApplication` |
| 0074 | Missing, mismatched, `cancelled`, or `no_show` Reservations fail closed (`STALE_ACTION` / `STALE` / refused) and emit no charge or mutation | `BookingAmendmentManager.#assertReservationConfirmed`, `ExtendedStayExtensionManager.#assertReservationConfirmed`, `NoticeToEndManager.#assertReservationConfirmed`, `CheckInSupportManager.upholdBlockingComplaintAsSupport` |
| 0091, 0092 | Platform support cannot uphold a complaint on a non-confirmed Reservation; Extended Stay extensions and Notice to End require a `confirmed` Reservation | `domains/shortlet/src/checkin-support.ts`, `apps/local-owner/src/local-owner-environment.ts`, `domains/shortlet/src/extended-stay-extension.ts`, `domains/shortlet/src/extended-stay-changes.ts` |

## Answer

Added fail-closed Reservation confirmation guards in the domain managers and cancellation closure rules per D3 and D29 (with owner decisions A1 and A2 adding `"cancelled"` to `AMENDMENT_TRANSITIONS` and `ExtensionStatus`):
- `BookingAmendmentManager` (`domains/shortlet/src/booking-amendment.ts`) now requires `reservationRepository.findReservationById`, checks that the Reservation exists, matches the contract and Primary Guest, and is `"confirmed"` on `requestAmendment`, `acceptAmendment`, `commitAmendment` entry, immediately before `settlementProvider.settle`, and immediately before `contractRepository.mutateContract`. Unpaid amendments (`proposed`, `accepted`, `awaiting_financial_settlement` without `settlementInFlight`) close to `"cancelled"` with zero charge on cancellation; an in-flight settlement refuses cancellation with reason until issue 05 supplies the refund side.
- `ExtendedStayExtensionManager` (`domains/shortlet/src/extended-stay-extension.ts`) now requires `reservations.findReservationById`, refuses preview/request/approve/decline unless the Reservation is `"confirmed"` (re-checking before `mutateContract`), projects `"cancelled"` on `statusOf` if the Reservation is no longer confirmed, and closes waiting (`awaiting_operator`) extensions to `"cancelled"` via `closeWaitingExtensionForCancellation`.
- `NoticeToEndManager` (`domains/shortlet/src/extended-stay-changes.ts`) now requires `reservations.findReservationById` and refuses `previewNotice` and `giveNotice` (re-checking before `mutateContract`) unless the Reservation is `"confirmed"`.
- `CheckInSupportManager.upholdBlockingComplaintAsSupport` (`domains/shortlet/src/checkin-support.ts`) now refuses fail closed unless the Reservation exists and is `"confirmed"` (wired in `apps/local-owner/src/local-owner-environment.ts`).
- `CancellationApplication` (`apps/web/src/cancellation-application.ts`) checks `#assertNoAmendmentSettlementInFlight` before transitioning the Reservation and closes unpaid amendments and waiting extensions via `#closePendingChangesForCancellation`.

## Comments

### Owner decisions & state-machine updates
- **A1 (26 Nov 2026):** Added `"cancelled"` to `PendingAmendment["status"]` and `AMENDMENT_TRANSITIONS` (`proposed`, `accepted`, `awaiting_financial_settlement` -> `"cancelled"`, `cancelled` -> `[]`).
- **A2 (26 Nov 2026):** Added `"cancelled"` to `ExtensionStatus` (`"awaiting_operator" | "approved" | "declined" | "expired" | "cancelled"`).
- Updated `docs/agents/state-machines.md` rows for `Booking amendment`, `Check-in support`, and `Extended stay extension` (including `NoticeToEndManager`) in the same commit (`test/state-machine-inventory.test.ts` passes).

### Failing check first & Mutation check (AC2, AC3, Gate 3 & Gate 4)
- **Red baseline before guard:** Converted `KNOWN DEFECT (issue 04)` in `test/after-booking-exploration.test.ts` to `AC2 (issue 04)` expecting 0 violations; running `npx tsx --test test/after-booking-exploration.test.ts` failed as expected (`5 !== 0`, shortest sequence `request, accept, cancel, commit` charging `10000` kobo on `SqliteBookingStateRepository`).
- **With guard (SQLite file storage):** `explored: 28`, `pruned: 22`, `violations: 0`, `shortestFailure: null`, all 4 steps (`request`, `accept`, `commit`, `cancel`) succeeded.
- **Mutation check (AC3):** Commenting out `if (reservation.status !== "confirmed") throw new Error("STALE_ACTION");` in `BookingAmendmentManager.#assertReservationConfirmed` caused `scripts/explore-after-booking.ts 6` to report `{"depth":6,"prune":true,"explored":40,"pruned":31,"violations":5,"shortestFailure":{"sequence":["cancel","request","accept","commit"],...,"chargedAfterCancelKobo":10000}}` and `test/after-booking-exploration.test.ts` failed `AC2 (issue 04)` (`5 !== 0`) and `AC7` (`40 !== 28`). Restoring the guard returned `28` explored, `22` pruned, `0` violations.

### Verification commands & pass counts
- `Remove-Item Env:LLM_API_KEY -ErrorAction SilentlyContinue; npm run check`: **passed** (0 errors across root, `apps/cloudflare`, `apps/cloudflare/tsconfig.test.json`, `apps/cloudflare/tsconfig.tooling.json`, and `scripts/check-worker-bundle.mjs`).
- `Remove-Item Env:LLM_API_KEY -ErrorAction SilentlyContinue; npx tsx --test test/after-booking-exploration.test.ts test/cancelled-accepts-no-change.test.ts test/amend-material-booking-terms.test.ts test/allow-list-hardening.test.ts test/short-stay-29-nights.test.ts test/continuous-occupancy.test.ts test/extended-stay-extension.test.ts test/extension-chat.test.ts test/extension-http.test.ts test/extension-owner-http.test.ts test/extension-owner-inbox.test.ts test/demo-extended-cancellation-notice.test.ts test/notice-to-end-wiring.test.ts test/integrate-cancellation-application.test.ts test/integrate-booking-amendment-application.test.ts test/back-office-uphold-complaint.test.ts test/verify-access-with-live-support.test.ts test/state-machine-inventory.test.ts`: **134/134 passed, 0 failed**.

### Definition of Done check
1. **Dedicated named test per AC:** AC1, D3, D29 in `test/cancelled-accepts-no-change.test.ts`; AC2 & AC7 in `test/after-booking-exploration.test.ts`; AC4 in `test/amend-material-booking-terms.test.ts`; AC5 in `docs/agents/state-machines.md` + `test/state-machine-inventory.test.ts`.
2. **Failure paths exercised:** `cancelled`, `no_show`, missing Reservation, another guest's Reservation, mid-commit pre-`settle` and pre-`mutateContract` races, unpaid amendment closure vs in-flight settlement refusal, Extension/Notice/Complaint-uphold refusals on `cancelled`/`no_show` (all on `SqliteBookingStateRepository`).
3. **ADRs listed and read:** ADRs 0045, 0058, 0060, 0072, 0074, 0091, 0092 recorded above.
4. **No unused injected dependency:** Verified across all modified domain/app classes.
5. **No invented policy string/rule/constant:** Status literals `"cancelled"` approved by owner decisions A1/A2; refusal messages trace to D3/D29/ADRs.
6. **No bearer credential or restricted identity material in audit records or logs:** Audit entries record ids and timestamps only (ADR 0075).
7. **`npm run check` and issue/affected tests pass:** Recorded above (0 check errors, 134/134 tests passing).
