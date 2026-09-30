# Map: guest UI consistency

PRD: `PRD.md` · Design: `design/` (canvas https://claude.ai/artifact/TKQCWTF4SWNscKrjLkN1zX)

Work top to bottom. The frontier is the first issue that is open, unblocked and unclaimed. Each issue ends with `npm run check` and `npm test` green, and a commit on the effort branch.

| # | Issue | Type | Blocked by |
|---|---|---|---|
| 01 | Start from an up-to-date main | task | none |
| 02 | Kit foundations: CSS components, icons and server HTML helpers | task | 01 |
| 03 | One app frame: top bar and journey rail everywhere; chat shell on foundation tokens | task | 02 |
| 04 | A stable presentation contract between the A2UI builders and the chat organizers | task | 02 |
| 05 | Discovery: one stay card, compact result rows, compare | task | 03, 04 |
| 06 | Unit detail parity (chat and page) | task | 03, 04 |
| 07 | Request screens: draft, review, sent, not accepted | task | 03, 04 |
| 08 | Offer screens: live and expired | task | 07 |
| 09 | Payment screens: choice, card, bank transfer, manual transfer, waiting, no reservation | task | 08 |
| 10 | Confirmation and system pages: confirmed, error pages, conversation without JavaScript | task | 03, 04 |
| 11 | Desktop split, dark mode and the final visual acceptance | task | 05, 06, 07, 08, 09, 10 |
| 12 | Decide what "Amount due now" and "Amount paid" mean | grilling | none (needs the user) |

Issue 12 needs a human answer. Issue 09 ships with today's amounts and labels if 12 is still open, and must not block on it.

## Kickoff prompt for a new session

> Implement the guest UI consistency effort in `.scratch/guest-ui-consistency/`. Read `PRD.md`, then `map.md`, and follow the implementation protocol in `AGENTS.md` for each issue in order, starting at the frontier (issue 01).
>
> - The approved design is in `design/`: open the `.dc.html` files and compare with `design/renders/`. The live canvas is https://claude.ai/artifact/TKQCWTF4SWNscKrjLkN1zX.
> - For each issue: claim it, read the ADRs it lists, write one failing test per acceptance criterion, implement, run `npm run check` and the full `npm test` (the browser phase takes ~12 minutes, so run it in the background), capture screenshots with the walkthrough, check the Definition of Done in `docs/agents/issue-tracker.md`, commit on `ui/guest-consistency`, then write the `## Answer` and a context pointer here.
> - Don't invent copy, amounts or times; ask me. Issue 12 needs my decision. Don't block on it.

## Context pointers
(Append one line per resolved issue: what landed and where.)
- 10: shared confirmation content in `apps/web-agent/src/confirmation-presentation.ts` and kit markup in `guest-kit.ts`; approved Reservation ID reference, projected paid/held-deposit breakdown, arrival steps and readable booking details. `ui-kit.ts` owns the shared app bar and framed error page; no-JS conversation uses kit rows/bubbles/rail/native composer. Tests: `test/guest-confirmation-system*.test.ts`; 16 captures in `screenshots/10/`. Commit `5b73998`; full suite 1218 non-browser + 154 Chromium passes, 1 pre-existing skip, zero failures; deviations and DoD in the issue.
- 01: `ui/editorial-refinement` merged with `origin/main` (PR 96 open, unmerged); effort branch `ui/guest-consistency` cut from it; `guest-ui-walkthrough` in `.claude/launch.json`; discovery notes for issue 05 in `issues/01-start-from-up-to-date-main.md`. Screenshots: `screenshots/01/`.
- 02: kit CSS in `apps/web/src/shortlet-foundations.css` ("Guest UI kit" block), icons in `apps/web/src/ui-kit.ts`, server helpers in `apps/local-guest/src/guest-kit.ts` (pages now render through them); tests in `test/guest-kit.test.ts`. Screenshots: `screenshots/02/`.
- 03: `appFrameHtml` (top bar + rail) on every standalone guest page via `pageShell({ frame })`; chat shell on `.ui-appbar`/`.ui-rail` and foundation tokens only; `LocalGuestApp.journeyForThread`. Tests: `test/guest-app-frame*.test.ts`, helper `test/helpers/guest-stage-pages.ts`. Screenshots: `screenshots/03/`.
- 04: `GUEST_FACT_LABELS` and `guestFact*` in `apps/web-agent/src/guest-content.ts`; builders emit ticket and money facts as label-prefixed Texts (`ticketFactComponents` in `booking-presentation.ts`); `client.ts` organizers use `guest-kit.ts` `ticketHtml`/`breakdownHtml`. Tests: `test/guest-presentation-contract*.test.ts`. Screenshots: `screenshots/04/`.
- 05: one `.ui-stay-card` (search page and chat workspace, `stayCardInnerHtml` in `guest-kit.ts`), phone result rows with "See both side by side", search chips, compare table with View per stay. Tests: `test/guest-discovery-consistency*.test.ts`. Screenshots: `screenshots/05/`.
- 06: one `.unit-detail-sheet` on the chat workspace and `/stays/:id` (where line, serif title, `.ui-tiles`, price block, "About this apartment"); kit helpers `unitTilesHtml`/`unitIndicativePriceHtml`/`unitAboutHtml` in `guest-kit.ts`, `unitTiles`/`unitStayTotalLabel` in `booking-presentation.ts`. Tests: `test/guest-unit-detail-consistency*.test.ts`. Screenshots: `screenshots/06/`. Deviations in the issue Comments (no provider line, ADR 0006; dropped nightly-rate/fees/amount-due lines).
- 07: shared request screen content in `apps/web-agent/src/request-presentation.ts` and markup in `guest-kit.ts`, used by chat and conventional draft/review/sent/not-accepted pages; native owner/freshness-checked POST actions reuse platform handlers; outcome recovery keeps criteria; neutral banner and steps replace the operator-response waiting panel. Tests: `test/guest-request-consistency*.test.ts`; 40 captures in `screenshots/07/`. Commit `f802424`; copy deviations and DoD recorded in the issue. Full suite: 1210 non-browser + 151 Chromium passes, 1 pre-existing skip, zero failures.
