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
- 01: `ui/editorial-refinement` merged with `origin/main` (PR 96 open, unmerged); effort branch `ui/guest-consistency` cut from it; `guest-ui-walkthrough` in `.claude/launch.json`; discovery notes for issue 05 in `issues/01-start-from-up-to-date-main.md`. Screenshots: `screenshots/01/`.
