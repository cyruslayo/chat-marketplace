# Start from an up-to-date main

Status: resolved
Type: task
Blocked by: none
Requested: 29 Sept 2026

## Why

The editorial work this effort builds on is on branch `ui/editorial-refinement` (commits 48831b0, 90cf2a5 and d2dfced) and is not merged. `origin/main` is 12 commits ahead of it, including `4557ff1 Open results from chat and lock in the must-fix guest and back-office UX`, which changed `apps/local-guest/src/guest-server.ts` (~194 lines). Building on a stale base guarantees conflicts in the exact files this effort edits.

## What to build

1. `git fetch`, check out `ui/editorial-refinement`, merge `origin/main` into it. A dry run on 29 Sept (`git merge-tree`) found no conflicts. Rebuild the bundles (`node apps/local-guest/scripts/build-client.mjs`) and commit the rebuilt `apps/local-guest/dist/*.js`.
2. Run `npm run check` and `npm test`. The browser phase takes about 12 minutes, so run it in the background with a long timeout.
3. Open a PR for `ui/editorial-refinement` → `main`. Ask the user before merging it.
4. Once merged, create the effort branch `ui/guest-consistency` from the new `main`.
5. Read what 4557ff1 changed in guest discovery ("open results from chat"). Issue 05 must reconcile the design's compact result rows with it. Write what you find in this issue's `## Answer`.
6. Add `.scratch/guest-ui-consistency/walkthrough.ts` to `.claude/launch.json` as `guest-ui-walkthrough` (port 3021). Check that it starts and prints the seven stage URLs. Check that `capture.ts` captures them.

## Acceptance criteria

- AC1: `ui/editorial-refinement` contains `origin/main`, and `npm run check` and `npm test` pass on it (report the counts).
- AC2: The effort branch `ui/guest-consistency` exists from a `main` that includes the editorial work (or, if the user hasn't merged the PR yet, from `ui/editorial-refinement` with a note here).
- AC3: The walkthrough starts all seven booking stages and `capture.ts` writes screenshots for every screen with no horizontal overflow reported.
- AC4: The `## Answer` describes how 4557ff1 presents discovery results in the chat, for issue 05.

## Notes

This issue changes no product behaviour. The only product changes are the rebuilt bundles and the merge.

## Comments

## Answer

- **AC1.** `ui/editorial-refinement` now contains `origin/main` (merge 2287c8f, no conflicts; the rebuilt bundles were identical, so no dist change). `npm run check` is clean. `npm test`: phase 1 (non-browser) 1178/1178 pass. Phase 2 (real Chrome) 130 tests, 129 pass on the full run. The one failure, `guest-new-conversation-chromium` AC1, passed (2/2) when rerun alone; it had run while I was capturing screenshots in another Chrome. PR: https://github.com/cyruslayo/chat-marketplace/pull/96 (not merged, waiting for the user).
- **AC2.** The PR is unmerged, so the effort branch `ui/guest-consistency` was created from `ui/editorial-refinement` at 2287c8f. Rebase onto `main` after the PR merges.
- **AC3.** `guest-ui-walkthrough` is in `.claude/launch.json` (port 3021, untracked file). It prints the seven stage URLs on 3021-3027. `capture.ts` wrote 28 screenshots (7 screens x 320/390/768/1280) to `screenshots/01/`. No horizontal overflow was reported.
- **AC4. How 4557ff1 presents discovery results in chat (for issue 05).** It did **not** change results markup or `client.ts`. It only adds a typed way to open a result: `viewResultIntent` in `concierge.ts` recognises "show me the apartment / the first one / number 2 / the last one". `LocalGuestApp#viewResultFromChat` picks the Unit from `artifact.facts.results` in display order (never from client input) and calls `#openUnitDetail`, the same path as the generated View action. With several results and none named it replies with the "Which one would you like to see?" text and quick replies "The first one", "The second one", "The third one" (max three). Out-of-range positions ask again. Issue 05's compact result rows must keep the results in the same display order and keep View as an action per row, so that ordinal positions still match what the Guest sees.
