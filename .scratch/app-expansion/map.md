# Map: app expansion

Plan: [PRD.md](PRD.md) · Method: [method.md](method.md) · Owner answers: [decisions.md](decisions.md) · Rules: [rules/](rules/)

**Frontier:** the first issue that is open, unblocked and unclaimed (Phase 0 complete; currently `06` `ready-for-human` in Rules, `2b-05` and `2b-06` in Design system; in Phase 3, `13` waits on guest-accounts 13 and the rest on owner decisions). Each issue follows AGENTS.md "Implementation protocol", ends with `npm run check` and its own and affected tests, and records the commands and counts in its Comments. One writer per worktree.

Two lanes run in parallel: **Rules** (2, 4) and **Design system** (1b, 2b). They meet at phase 3.

## Phase 0: one baseline

| # | Issue | Type | Status | Blocked by |
| --- | --- | --- | --- | --- |
| 01 | [Bring the design and surface documents onto this branch](issues/01-bring-documents-across.md) | task | resolved | – |
| 02 | [Reconcile the shared component library with the typed components on main](issues/02-reconcile-surface-kit.md) | research | resolved | – |

## Phase 1: rules and checks

| # | Issue | Type | Status | Blocked by |
| --- | --- | --- | --- | --- |
| 03 | [Exploration harness and the two trial checks](issues/03-exploration-harness.md) | task | resolved | – |
| 04 | [A cancelled Reservation accepts no change](issues/04-cancelled-accepts-no-change.md) | task | resolved | 03 |
| 05 | [A half-done cancellation is always finished](issues/05-cancellation-always-finishes.md) | task | resolved | 03, 04 |
| 06 | [Close rules page 01: settle 26 cells and 8 scenarios](issues/06-close-rules-01.md) | grilling | ready-for-human | – |

## Phase 1b: the Xenia look, without moving anything

| # | Issue | Type | Status | Blocked by |
| --- | --- | --- | --- | --- |
| 07 | [Xenia tokens in the code's own token names](issues/07-xenia-tokens.md) | task | resolved | – |
| 08 | [Design round 12: missing boards and new components](issues/08-design-round-12.md) | task | resolved | – |
| 09 | [Self-hosted type, measured on a slow phone](issues/09-self-hosted-type.md) | task | resolved | 07 |

## Phase 2b: port the components, one group per issue

Each issue moves one group to [bundle.css](design/round-12/bundle.css) via [class-map.md](design/round-12/class-map.md), changes no copy or behaviour, keeps code-only classes unless replaced, and ends with 320/390/768/1280 light & dark captures. Chat components (`2b-05`, `2b-06`) land in the library format that `02` settles.

| # | Issue | Type | Status | Blocked by |
| --- | --- | --- | --- | --- |
| 2b-01 | [Buttons, links, fields, banners and status](issues/2b-01-buttons-links-fields-banners-status.md) | task | resolved | 07 |
| 2b-02 | [App bar and journey rail](issues/2b-02-app-bar-and-rail.md) | task | resolved | 07, 2b-01 |
| 2b-03 | [Stay ticket and price band](issues/2b-03-stay-ticket-and-price-band.md) | task | resolved | 07, 2b-01 |
| 2b-04 | [Result rows, list rows, view switch and stay cards](issues/2b-04-result-rows-and-stay-cards.md) | task | resolved | 07, 2b-01 |
| 2b-05 | [Chat message, persona, chips, composer and multi-domain controls](issues/2b-05-chat-message-chips-composer.md) | task | ready-for-agent | 07, 02, 2b-01 |
| 2b-06 | [Chat card, action bar, disclosure and commit panels](issues/2b-06-chat-card-action-bar-disclosure.md) | task | ready-for-agent | 07, 02, 2b-01 |
| 2b-07 | [Operator shell, queue, transfer check and receipt preview](issues/2b-07-operator-shell-and-queue.md) | task | resolved | 07, 2b-01 |
| 2b-08 | [Move /welcome to the Xenia brand layer](issues/2b-08-welcome-landing.md) | task | resolved | 07, 09, 2b-01, 2b-02 |
| 27 | [Bring main in and renumber the cancellation migration to 7](issues/27-sync-main-schema-v7.md) | task | resolved | none |

## Phase 3: the frame

| # | Issue | Type | Status | Blocked by |
| --- | --- | --- | --- | --- |
| 10 | [Domain rows: a pack supplies its part of the guest's list](issues/10-domain-rows.md) | task | resolved | – |
| 11 | [The guest's list at `/plans`](issues/11-plans-page.md) | task | needs-info | 10, guest-accounts 13, D8, D9, D10; replaces guest-stays 03, 04 |
| 12 | [Navigation table and reachability check](issues/12-navigation-check.md) | task | resolved | – |
| 13 | [Emails open their own item, and sign-in returns to it](issues/13-email-links.md) | task | ready-for-agent | guest-accounts 13 |
| 14 | [When the concierge fails, offer the list](issues/14-concierge-unavailable.md) | task | needs-info | copy approval |
| 15 | [Tab bar, Ask bar, task bar and desktop rail](issues/15-shell.md) | task | needs-info | 07, 08, 11, 12 |
| – | Find: one criteria state for concierge and list | task | to slice | 15 |
| – | Help screen | task | to slice (16) | D6, D13, 15 |

## Phase 4: living in the stay

Sliced only after rules page 01 passes gate 2.

| # | Work | Blocked by |
| --- | --- | --- |
| 17 | Stay page by stage, as one projection shared with chat | 11, rules 01 |
| 18 | Cancel: exact refund, commit, refund state | 05, D16, D20 |
| 19 | Change or cancel page; Short Stay change; links to extension and notice | 04, D17 |
| 20 | Report a problem: intake, human ownership, state shown | D6, D18 |
| 21 | Arrival: address and access | D7 |
| 22 | Payments and receipts (monthly-stays 10) | D19 |
| 23 | Servicing and maintenance (monthly-stays 12) | 20 |

## Phase 5: coming back

guest-stays 11, 12 (saved), 02 and 08–10 (messages), 05–07 (reviews), re-read against the stay page before they start.

## Phase 6: ready for a second domain

| # | Issue | Type | Status | Blocked by |
| --- | --- | --- | --- | --- |
| 24 | [One on/off setting per domain](issues/24-domain-switch.md) | task | needs-info | D12 |
| 25 | [Remove stay-only assumptions from the pack contract](issues/25-neutral-contract-leftovers.md) | task | ready-for-agent | 10 |
| 26 | Events ADR and vocabulary, draft for the owner | grilling | to write | D12 |

## Cross-effort edges

- **state-machines 27** (payment-stage guards) is needed for rules 01. **25** overlaps trial C.
- **ux-guidelines 33–37** touch screens phase 2b ports. Do them first, or fold each into its port; never both at once. **38** conflicts with decision A5.
- **guest-stays 04** is replaced by 11. Its AC1 (sign-in redirect) changes if D8 is yes.
- **guest-accounts 13** decides whether a signed-in second device can open its own pages. 11 and 13 wait for it.
- **AGENTS.md on `main`** says the Payment Window starts at Accept Offer. ADR 0044 and `conditional-offer.ts` start it at Operator confirmation; the owner's one-line correction is committed on this branch (D22) and stays uncommitted in the original checkout, so a later merge there meets the same text.
- **feat/submit-diagnostic** (3 commits) is unmerged and touches the client bundle.
- `apps/local-guest/src/client.ts`, `guest-server.ts`, `shortlet-app.ts` and `shortlet-foundations.css` are serial: one issue at a time.

## Batch gates

After each phase: `npm run check`, `npm run test:workers`, the full `npm test` (background), and `capture-11-all.sh` when CSS or the shell changed. Merge to `main` only on the owner's explicit approval.

## Context pointers

(One line per resolved issue.)

- 01: ADR 0108, the surface plan, the kit audit and the library plan are on this branch; see the issue for the one glossary file that differs from `main`.
- 02: Reconciled `feat/surface-kit-phase-1` (`5367de7`) against `feat/app-expansion`'s 9 typed components in [notes/02-surface-kit.md](notes/02-surface-kit.md) (14 git conflicts + 3 semantic conflicts; byte-identical `v1` schemas verified; recommended staged cherry-pick Follow-ups A–C; classified round-12 chat components and added dated reconciliation notes to `2b-05` and `2b-06`).
- 03: `test/helpers/explore.ts` (`exploreOrders`, `exploreFailures` with digest pruning and `check.reads` guard), `test/helpers/booking-state-fixture.ts`, `scripts/explore-after-booking.ts`, `test/explore-helper.test.ts`, and `test/after-booking-exploration.test.ts` (recording `KNOWN DEFECT` issue 04 & 05 baselines on `SqliteBookingStateRepository`).
- 08: Pinned round-12 delivery under `design/round-12/` (24 boards, `tokens.css`, `xenia-kit.css`, `bundle.css`, `README.md`, `fact-map.md`, `copy-decisions.md`, `class-map.md`), resolved 08 with Handover follow-ups recorded, and sliced Phase 2b (`issues/2b-01`–`2b-07`).
- 07: Mapped Xenia light/dark/system-dark tokens onto semantic names in `apps/web/src/shortlet-foundations.css`, updated `--mode-*` stays tokens to clay, updated `apps/web/src/shortlet-landing.css` and `apps/local-guest/src/shell-theme-colour.ts`, added `test/shortlet-token-parity.test.ts` (kickoff I2), updated palette assertions, and verified `capture-11-all.sh` into `screenshots/07/`.
- 09: Added self-hosted `@font-face` (`Newsreader` 500/400i, `Hanken Grotesk` 400–700, `font-display: swap`, metric-adjusted fallbacks) and Newsreader money rules in `shortlet-foundations.css`, served `/landing/fonts/*` on `local-owner-server.ts`, pointed `test/shortlet-token-parity.test.ts` at `design/round-12/tokens.json`, recorded Fast 3G before/after (max CLS `0.0203`), and verified `capture-11-all.sh` into `screenshots/09/`.
- 2b-01: Ported atomic controls and status primitives (`.ui-visually-hidden`, `.ui-button*`, `.ui-link`, `.ui-field*`, `.ui-choice`, `.ui-legend`, `.ui-status*` incl. `--muted`, `.ui-tag*`, `.ui-deadline*`, `.ui-banner*`, `.ui-empty*`, static `.ui-skeleton*`) in `apps/web/src/shortlet-foundations.css`, added `test/round12-class-parity.test.ts` and `test/round12-2b-01.test.ts`, held back unapproved issue-07 tokens and copy, and verified 41/41 unit/browser checks + 21-group captures in `screenshots/2b-01/`.
- 2b-02: Ported round-12 `.ui-appbar*`, `.ui-mode-label*`, `.ui-agent-mark*`, `.ui-badge`, `.ui-app*`, `.ui-sidenav*`, `.ui-dialog*`, `.ui-page--short`/short-phone trim, and compact/full `.ui-rail-nav*` in `shortlet-foundations.css`, synchronized compact (`Step N of 6 · <label>`) + full rail markup in `guest-kit.ts` `railHtml` and `client.ts` `renderJourney`, held back `--color-scrim` and unshipped routes/copy, and verified 61+4 tests + cold restore + 21-group captures in `screenshots/2b-02/`.
- 2b-03: Ported `.ui-ticket*` (`.ui-ticket__eyebrow` in sand, sand `:focus-visible`), `.ui-price-breakdown*` (`--band`, hairline top-ruled `--due`/`--paid`, `--condition` using `--radius-small`), `.ui-tiles*`, and `.ui-steps*` (`--compact`, Newsreader numerals) in `shortlet-foundations.css` and `guest-kit.ts`, preserved zero-deposit omission and shipped copy, held back `--radius-badge`, and verified 49/49 tests + 21-group captures in `screenshots/2b-03/`.
- 2b-04: Ported `.ui-stay-card*` (`__body`, `__label`, 44px `__title`), `.ui-result-rows`/`.ui-result-row*` (`--muted`, `--no-thumb`, `__next`), `.ui-list*` (`__row--static`, `__aside--money`, `[aria-busy]`), and `.ui-segmented` (`> a` & `> label`, `--radius-control`) in `shortlet-foundations.css`, `guest-kit.ts`, and `shortlet-renderers.ts`, preserved `.stay-card`/`.stay-grid` hooks and `"1 / N"` copy, held back `Save`/`Saved` and `/plans` view switch, and verified 60/60 tests + 21-group captures in `screenshots/2b-04/`.
- 2b-07: Ported Operator `.ui-shell*`, `.ui-sidenav*`/`.ui-sidenav-compact*`, `.ui-breadcrumb*`, deadline-sorted `.ui-queue*` (no-deadline items last, lazy `Overdue` tag), `.ui-outcome*`, `.ui-panel--commit`, `.ui-effect*`, `.ui-transfer*`, `.ui-reference`, and `.ui-receipt*` (image/PDF/90d-deleted) in `shortlet-foundations.css`, `ui-kit.ts`, `back-office-view.ts`, and `local-owner-server.ts`, enforced decision A5 (`"Owner payouts"`, no guest names, `"Decline"`, `"Confirm payment"`), and verified 46/46 Operator tests + 7-route Operator captures & 21-group guest sweep into `screenshots/2b-07/`.
- 04: Added fail-closed Reservation `confirmed` guards in `BookingAmendmentManager`, `ExtendedStayExtensionManager`, `NoticeToEndManager`, and `CheckInSupportManager.upholdBlockingComplaintAsSupport`, added `"cancelled"` closure states to `AMENDMENT_TRANSITIONS` and `ExtensionStatus` (D3/D29), wired cancellation cleanup and in-flight settlement refusal in `CancellationApplication`, updated `docs/agents/state-machines.md`, and verified on SQLite (`28` explored / `22` pruned / `0` violations; mutation check `40` explored / `5` violations).
- 05: Added durable `SqliteCancellationCaseRepository` (`cancellation_cases` migration v6 + DO export), independent ledger/date-release/refund steps with SQL CAS + per-DB resume guard in `CancellationApplication`, read-time retry on `getArtifact`, recorded stay/deposit refund obligation ports wired to Operator Home and `recordGuestRefund` (D4/D28 P2), guest artifact `dates`/`refunds` read model, and `CancellationCase` row in `docs/agents/state-machines.md`; verified on SQLite (`16` failure combos / `0` violations; mutation check `15` violations) and Worker specs.
- 12: Added `test/guest-navigation.test.ts` with `GUEST_NAVIGATION_TABLE` (17 live guest routes, 14 non-page GET allow-list entries, 6 planned phase 3/4 rows), static route discovery over `guest-server.ts` and `landing-route-module.ts`, live rendering via `sendGuest`/`withStagePage`, served-target verification (AC3), and a rules N1–N11 ratchet (`unrecordedFailures`/`staleGaps`).
- 10: Added closed `planRows` contract and fail-closed `composePlanRows` (`apps/local-guest/src/assistant/plan-rows.ts`), Stays implementation (`apps/local-guest/src/assistant/shortlet-plan-rows.ts`) over durable stores with lazy deadlines and exhaustive `GuestStage` mapping, `LocalGuestApp.planRows` + rebuilt `committedWork` (`apps/local-guest/src/shortlet-app.ts`), and `test/domain-plan-rows.test.ts` (AC1–AC6 + 24-cell decision table + identical 404 parity).
