# Phase 2b-07: Port Operator shell, queue, transfer check and receipt preview

Status: resolved
Type: task
Blocked by: 07, 2b-01

## Why

Port the accepted Operator back-office boards (`Xenia Atomic UI Kit.html` Operator screens and `bundle.css` Operator rules) — responsive side navigation + compact `<details>` bar, deadline-sorted queue, breadcrumb, action outcomes, side-by-side manual transfer check, and receipt preview — into `apps/web/src/shortlet-foundations.css`, `apps/local-owner/src/back-office-view.ts`, and `apps/local-owner/src/local-owner-server.ts`.

## What to build

- Port `.ui-shell` / `.ui-shell__main`, `.ui-sidenav*` + `.ui-sidenav-compact*`, `.ui-breadcrumb`, `.ui-queue` / `.ui-queue-item*` (replacing `.bo-waiting*` per `bundle.css` & [class-map.md](../design/round-12/class-map.md)), `.ui-outcome*`, `.ui-transfer*` / `.ui-reference`, and `.ui-receipt*` (including PDF `.ui-receipt__file` and deleted-after-90-days `.ui-receipt__gone`).
- Honour owner decision **A5** (`decisions.md`): no guest names on Operator screens; keep `"Decline"`, `"Owner payouts"`, `"Confirm payment"`. (Do **not** implement `ux-guidelines/issues/38`.)
- Keep `docs/design/xenia-ui-kit-parity-audit.md` §4 requirements intact (items with no deadline sort after deadline items; overdue computed lazily at render; versioned optimistic-concurrency forms per `ADR 0072`).
- Serial files: `apps/web/src/shortlet-foundations.css`, `apps/local-owner/src/back-office-view.ts`, `apps/local-owner/src/local-owner-server.ts`.

## Acceptance criteria

- AC1: At 320px and 390px, `.ui-sidenav-compact` collapses navigation behind a >=44px toggle so the page title stays visible above the fold; at `48rem+`, `.ui-sidenav` sits alongside `.ui-shell__main`.
- AC2: Operator home queue renders `.ui-queue-item` rows sorted by deadline with lazy `Overdue` tags; no guest names appear on Operator screens (decision A5).
- AC3: Manual transfer verification renders `.ui-transfer` side-by-side from `48rem`, supports image/PDF/deleted-after-90-days `.ui-receipt` states, and keeps all form guards (`ADR 0072`, `ADR 0090`).
- AC4: Operator screen captures at 320/390/768/1280 light and dark under `screenshots/2b-07/` pass with zero overflow and zero targets <44px.

## Integrity checks (`kickoff.md` §4)

- **I1 (Fact map):** Operator queue, booking detail, and transfer facts trace to `waitingItems()`, `booking-projection.ts`, and `ManualTransferManager` (`docs/design/xenia-ui-kit-parity-audit.md` §4).
- **I2 (Token parity):** Semantic tokens only; zero hex outside the token block.
- **I3 (Class parity):** Matches `class-map.md`; zero `xk-*`/`bd-*` classes in `apps/`.
- **I4 (Copy provenance):** Uses existing Operator copy module (`local-owner-server.ts` / `back-office-view.ts` / `owner-content`); respects decision A5.
- **I5 (Rules gate):** No unbuilt Operator cancel/refund controls outside existing wired routes.
- **I8 (Captures):** 320/390/768/1280 light & dark captures + `capture-11-all.sh` pass.
- **I10 (Scope):** Stays only; commerce stays off.

## ADR compliance

| ADR | Constraint imposed | Affected acceptance criterion / code path |
| --- | --- | --- |
| 0041 | Booking Request deadline sorting and attestation re-check remain unchanged | AC2 / `waitingItems`, `decisionFormsHtml` (`local-owner-server.ts`) |
| 0071 | Redacted Operator projections without guest identity leakage | AC2, A5 / `waitingItems`, `operatorInboxHtml`, `operatorHomeHtml` |
| 0072 | Versioned optimistic concurrency (`basedOnVersion`, `expectedVersion`) on every Operator decision/transfer form | AC3 / `decisionFormsHtml`, `manualTransferCard` (`local-owner-server.ts`) |
| 0075 | No secret or unredacted personal guest data leaked in Operator DOM/logs (Decision A5) | AC2, AC3, I1 / removed `primaryGuestName` in `operatorInboxHtml` |
| 0078 | >=44px interactive controls, 0 horizontal overflow, compact phone nav keeping `<h1>` above fold | AC1, AC4 / `.ui-sidenav-compact*`, `.ui-shell*`, `.ui-breadcrumb*`, captures |
| 0082 | Representative grant scoping across Operator read/action routes remains unchanged | I1 / `listOperatorRequestArtifacts`, `manualTransferReceipt` |
| 0086 | Operator session lifetime, sign-in reasons, and CSRF/origin checks unchanged | I1 / `back-office-home.test.ts` |
| 0090 | Receipt preview reads content type from `/operator/transfers/:id/receipt`, supports image/PDF/90-day deletion, never proof | AC3 / `manualTransferCard` `.ui-receipt*`, `.ui-panel--commit` |
| 0091 | Check-in and fulfilment complaint forms/grounds preserved | I5 / `operatorReservationHtml`, `checkInFormsHtml` |

## Tests

`npm run check`, `apps/local-owner` / back-office unit & browser tests (including `back-office-manual-transfers`, `back-office-owner-overpayment`, `back-office-layout` etc. solo), and captures. Record exact commands, counts, and capture findings in `## Comments`.

## Comments

- Ported `2b-07` Operator shell, queue, outcome, transfer check, and receipt preview rules in [shortlet-foundations.css](../../../apps/web/src/shortlet-foundations.css) (`.ui-shell*`, `.ui-sidenav-compact__list`, `.ui-breadcrumb*`, `.ui-queue*`, `.ui-panel--commit`, `.ui-panel__title`, `.ui-effect*`, `.ui-outcome*`, `.ui-transfer*`, `.ui-reference`, `.ui-receipt*`).
- Added optional `layout?: "page" | "shell"` to `pageShell()` in [ui-kit.ts](../../../apps/web/src/ui-kit.ts).
- Updated [back-office-view.ts](../../../apps/local-owner/src/back-office-view.ts) (`"Owner payouts"` per decision A5, `.ui-sidenav` + `.ui-sidenav-compact`, `breadcrumbHtml`) and [local-owner-server.ts](../../../apps/local-owner/src/local-owner-server.ts) (`waitingItems` `hasDeadline` flag sorting no-deadline items last oldest first, `.ui-queue`/`.ui-queue-item` with lazy `Overdue` tag and primary/quiet action hierarchy, removed `primaryGuestName` per decision A5, added breadcrumbs on request/booking/reservation detail pages, and updated `manualTransferCard` with `.ui-transfer`, `.ui-receipt` image/PDF/90d-deleted states, `.ui-panel--commit`, `.ui-effect`, and `.ui-outcome` while preserving `.bo-transfer`, `expectedVersion`, `"Confirm payment"`, and `"Decline"`).
- Updated [test/back-office-home.test.ts](../../../test/back-office-home.test.ts) (`.ui-sidenav`/`.ui-queue-item`), [test/back-office-request-inbox.test.ts](../../../test/back-office-request-inbox.test.ts) (A5 zero guest names), and [test/back-office-owner-payables.test.ts](../../../test/back-office-owner-payables.test.ts) (A5 `"Owner payouts"`).
- **Decision A5 & Held-back copy:** Applied settled A5 (`"Owner payouts"`, zero guest names, `"Decline"`, `"Confirm payment"`); kept all shipped Operator status/error strings without unapproved `New`/`Brand` strings (`GET /operator/transfers/:id` standalone route deferred as `.bo-transfer` cards already support full side-by-side layout on `/operator/transfers`).
- **Verification:**
  - TDD Red run: `npx tsx --test test/round12-class-parity.test.ts test/round12-2b-07.test.ts` -> `2 pass, 4 fail` (AC1/A5, AC2/A5, AC3, and `2b-07` I3 failed prior to implementation).
  - `npm run check && npx tsx --test test/round12-class-parity.test.ts test/back-office-home.test.ts test/back-office-request-inbox.test.ts test/back-office-owner-payables.test.ts test/operator-detail-clarity.test.ts test/shortlet-design-system.test.ts test/shortlet-token-parity.test.ts test/guest-retired-classes.test.ts && npx tsx --test test/back-office-manual-transfers.test.ts && npx tsx --test test/back-office-owner-overpayment.test.ts && npx tsx --test test/round12-2b-07.test.ts` -> **33 pass, 0 fail** + **5 pass, 0 fail** + **5 pass, 0 fail** + **3 pass, 0 fail** (**46/46 pass**).
  - Operator captures across 7 routes (`op-home`, `op-requests`, `op-request-detail`, `op-transfers`, `op-bookings`, `op-booking-detail`, `op-payouts`) at `320`, `390`, `768`, `1280` light & dark into `.scratch/guest-ui-consistency/screenshots/2b-07/`: **0 findings (0 overflow, 0 actionable controls <44px)**.
  - Final 21-group guest `capture-11.ts` check: **0 horizontal overflow**, **0 actionable controls under 44px** across all 21 groups (only expected 1x1 hidden radio `<input>`s on `payment-choice`).
  - Post-commit `npx tsx --test test/landing-page.test.ts` (see git log / final report).
