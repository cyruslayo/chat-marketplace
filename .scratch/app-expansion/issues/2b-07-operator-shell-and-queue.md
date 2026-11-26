# Phase 2b-07: Port Operator shell, queue, transfer check and receipt preview

Status: ready-for-agent
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

0041, 0071, 0072, 0075, 0078, 0082, 0086, 0090, 0091.

## Tests

`npm run check`, `apps/local-owner` / back-office unit & browser tests (including `back-office-manual-transfers`, `back-office-owner-overpayment`, `back-office-layout` etc. solo), and captures. Record exact commands, counts, and capture findings in `## Comments`.

## Comments
