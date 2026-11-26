# Map: app expansion

Plan: [PRD.md](PRD.md) · Method: [method.md](method.md) · Owner answers: [decisions.md](decisions.md) · Rules: [rules/](rules/)

**Frontier:** the first issue that is open, unblocked and unclaimed (currently `02` in Phase 0, `04` in Rules, `07` in Design system). Each issue follows AGENTS.md "Implementation protocol", ends with `npm run check` and its own and affected tests, and records the commands and counts in its Comments. One writer per worktree.

Two lanes run in parallel: **Rules** (2, 4) and **Design system** (1b, 2b). They meet at phase 3.

## Phase 0: one baseline

| # | Issue | Type | Status | Blocked by |
| --- | --- | --- | --- | --- |
| 01 | [Bring the design and surface documents onto this branch](issues/01-bring-documents-across.md) | task | resolved | – |
| 02 | [Reconcile the shared component library with the typed components on main](issues/02-reconcile-surface-kit.md) | research | ready-for-agent | – |

## Phase 1: rules and checks

| # | Issue | Type | Status | Blocked by |
| --- | --- | --- | --- | --- |
| 03 | [Exploration harness and the two trial checks](issues/03-exploration-harness.md) | task | resolved | – |
| 04 | [A cancelled Reservation accepts no change](issues/04-cancelled-accepts-no-change.md) | task | ready-for-agent | 03 |
| 05 | [A half-done cancellation is always finished](issues/05-cancellation-always-finishes.md) | task | ready-for-agent | 03, 04 |
| 06 | [Close rules page 01: settle 26 cells and 8 scenarios](issues/06-close-rules-01.md) | grilling | ready-for-human | – |

## Phase 1b: the Xenia look, without moving anything

| # | Issue | Type | Status | Blocked by |
| --- | --- | --- | --- | --- |
| 07 | [Xenia tokens in the code's own token names](issues/07-xenia-tokens.md) | task | ready-for-agent | – |
| 08 | [Design round 12: missing boards and new components](issues/08-design-round-12.md) | task | resolved | – |
| 09 | [Self-hosted type, measured on a slow phone](issues/09-self-hosted-type.md) | task | ready-for-agent | 07 |

## Phase 2b: port the components, one group per issue

Each issue moves one group to [bundle.css](design/round-12/bundle.css) via [class-map.md](design/round-12/class-map.md), changes no copy or behaviour, keeps code-only classes unless replaced, and ends with 320/390/768/1280 light & dark captures. Chat components (`2b-05`, `2b-06`) land in the library format that `02` settles.

| # | Issue | Type | Status | Blocked by |
| --- | --- | --- | --- | --- |
| 2b-01 | [Buttons, links, fields, banners and status](issues/2b-01-buttons-links-fields-banners-status.md) | task | ready-for-agent | 07 |
| 2b-02 | [App bar and journey rail](issues/2b-02-app-bar-and-rail.md) | task | ready-for-agent | 07, 2b-01 |
| 2b-03 | [Stay ticket and price band](issues/2b-03-stay-ticket-and-price-band.md) | task | ready-for-agent | 07, 2b-01 |
| 2b-04 | [Result rows, list rows, view switch and stay cards](issues/2b-04-result-rows-and-stay-cards.md) | task | ready-for-agent | 07, 2b-01 |
| 2b-05 | [Chat message, persona, chips, composer and multi-domain controls](issues/2b-05-chat-message-chips-composer.md) | task | ready-for-agent | 07, 02, 2b-01 |
| 2b-06 | [Chat card, action bar, disclosure and commit panels](issues/2b-06-chat-card-action-bar-disclosure.md) | task | ready-for-agent | 07, 02, 2b-01 |
| 2b-07 | [Operator shell, queue, transfer check and receipt preview](issues/2b-07-operator-shell-and-queue.md) | task | ready-for-agent | 07, 2b-01 |

## Phase 3: the frame

| # | Issue | Type | Status | Blocked by |
| --- | --- | --- | --- | --- |
| 10 | [Domain rows: a pack supplies its part of the guest's list](issues/10-domain-rows.md) | task | ready-for-agent | – |
| 11 | [The guest's list at `/plans`](issues/11-plans-page.md) | task | needs-info | 10, guest-accounts 13, D8, D9, D10; replaces guest-stays 03, 04 |
| 12 | [Navigation table and reachability check](issues/12-navigation-check.md) | task | ready-for-agent | – |
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
- 03: `test/helpers/explore.ts` (`exploreOrders`, `exploreFailures` with digest pruning and `check.reads` guard), `test/helpers/booking-state-fixture.ts`, `scripts/explore-after-booking.ts`, `test/explore-helper.test.ts`, and `test/after-booking-exploration.test.ts` (recording `KNOWN DEFECT` issue 04 & 05 baselines on `SqliteBookingStateRepository`).
- 08: Pinned round-12 delivery under `design/round-12/` (24 boards, `tokens.css`, `xenia-kit.css`, `bundle.css`, `README.md`, `fact-map.md`, `copy-decisions.md`, `class-map.md`), resolved 08 with Handover follow-ups recorded, and sliced Phase 2b (`issues/2b-01`–`2b-07`).
