# Animate a mode switch with a feature-detected, typed View Transition

Status: resolved
Type: task (UI; a real-browser test is in scope)
Blocked by: 03g (the strip and sheet are the switch controls; the transition runs on the switch they commit), 03c (resolved: the client applies the server's mode). Owner release before any build (ADR 0107 "Settled", 8 Nov 2026).
Requested: 16 Nov 2026

## Open owner decisions

1. **Duration and easing.** Which motion tokens? `apps/web/src/shortlet-foundations.css` defines `--duration-fast` (140 ms), `--duration-base` (200 ms), `--duration-slow` (320 ms) and `--ease-standard`. Recommendation: `--duration-base` with `--ease-standard`.
2. **What crosses.** Analysis 5.5 proposes a root cross-fade for the transcript, and named elements (`app-bar`, `composer`, `persona`) that stay in place. Owner to confirm both, or only the named elements.
3. **Hero transition.** The first-message hero transition (`withAgentMarkTransition`) stays as it is, untyped and guarded. Owner to confirm this issue leaves it alone.
4. **Where the rules live.** The `mode-switch` rules go in the "Guest UI kit" block of `shortlet-foundations.css` (the tokens are there) or inline in `guest-server.ts`. Recommendation: the foundations file, under the existing reduced-motion pattern.

## Parent

[Agent modes architecture analysis](../architecture-analysis.md), section 5.5 (the switch moment: motion and accessibility); [ADR 0107](../../../docs/adr/0107-present-each-domain-pack-as-an-agent-mode.md) decision 7 (a switch is announced and need not animate; View Transitions are feature-detected, typed `mode-switch`, and skipped under reduced motion). Map slice `5-motion`.

## Why

Facts from the survey:

- The client already starts an untyped same-document transition for the first message: `withAgentMarkTransition` (`apps/local-guest/src/client.ts:1596` to `:1604`). Its guard skips the transition once the empty state is hidden, because a running transition widened the page at 375 px. A mode switch must not change that path.
- `applyResponseMode` (`client.ts:1550` to `:1554`, with the 03c comment at `:1552`) sets `data-mode` on the root from the validated response with no transition and no announcement.
- `apps/local-guest/src/response-mode.ts:19` to `:27` applies the mode only from a validated presentation. Nothing in the shell animates a switch.
- AGENTS.md (browser support): a newly available feature is used only with feature detection and graceful degradation. View Transitions with a type argument are newly available, so the code tries the typed call, falls back to the untyped call, and falls back again to an instant update.
- The motion rules must follow the existing reduced-motion pattern (`shortlet-foundations.css:474` onward uses `prefers-reduced-motion: no-preference`).

## What to build

1. **Trigger.** A mode switch that the server confirmed (the response changed `data-mode`) runs through one function. It is never triggered by a preview or by an ordinary turn.
2. **Typed call.** When `document.startViewTransition` exists, call it with `{ update, types: ["mode-switch"] }`.
3. **Fallback.** If the typed call throws, call the untyped form. If that also throws or is missing, run `update` directly. The instant update is always correct.
4. **Reduced motion.** Under `prefers-reduced-motion: reduce`, run `update` directly and start no transition.
5. **Rules.** Cross-fade rules sit under `:active-view-transition-type(mode-switch)` only, so ordinary turns do not animate. Named elements keep their `view-transition-name` (owner decision 2). Motion is inside `prefers-reduced-motion: no-preference`.
6. **Hero path unchanged.** `withAgentMarkTransition` and its guard are not changed.
7. **Order.** The announcement (03l) and the focus rule (03i decision 3) are not changed by this issue.

## ADRs to read first

| ADR | Constraint | Where it lands |
| --- | --- | --- |
| 0107 decision 7 | Typed `mode-switch`, feature-detected, skipped under reduced motion, instant update always correct. | Steps 2 to 4; AC 1 to 4. |
| 0107 decision 9 (motion) | Motion is `transform` and `opacity`; nothing loops past 5 s. | Step 5 (cross-fade only). |
| 0078 | Reduced motion; 320 px reflow; no horizontal overflow during or after a transition. | AC 9 and 10. |
| 0107 decision 2 and 6 | The mode is applied only from the validated response. | Step 1. |
| AGENTS.md "Browser support" | Feature detection and graceful degradation for newly available features. | Steps 2 and 3. |

## Acceptance criteria

Each is its own `test()` in `test/agent-mode-view-transition.test.ts` (new), except AC 9 and 10, which are the real-browser file `test/agent-mode-view-transition-chromium.test.ts` (new).

1. A confirmed mode switch calls `startViewTransition` with the type `mode-switch` when the typed form is supported.
2. A confirmed mode switch with no `startViewTransition` applies the mode instantly and sets `data-mode` correctly.
3. A confirmed mode switch under `prefers-reduced-motion: reduce` runs the update with no transition call.
4. A typed call that throws falls back to the untyped form, and if that throws too the update still runs.
5. An ordinary turn that does not switch mode starts no mode-switch transition.
6. The first-message hero transition behaves as before (its guard test still passes unchanged).
7. The cross-fade rules apply only under `:active-view-transition-type(mode-switch)` (a stylesheet test).
8. The cross-fade rules sit inside `prefers-reduced-motion: no-preference` (a stylesheet test).
9. In Chromium at 375 px, a switch leaves no horizontal overflow during or after the transition.
10. In Chromium under reduced motion, no view transition is running after a switch (`document.getAnimations()` is empty).

## Verification

- `env -u LLM_API_KEY npm run check`.
- Local: `env -u LLM_API_KEY npx tsx --test test/agent-mode-view-transition.test.ts test/agent-mark-shell.test.ts` and any test in `test/` that matches the "Guest UI kit" block of `shortlet-foundations.css` (find them with a grep before running; do not run a formatter on that file).
- Real Chrome, one file at a time, solo: `test/agent-mode-view-transition-chromium.test.ts`, then `test/agent-mark-chromium.test.ts` (the hero path shares the same transition helper).
- Captures at 320, 390, 768 and 1280 px, light and dark, of a switch with two modes registered in the test composition, saved under `screenshots/<issue number>/`.
- Record the exact commands and pass counts under `## Comments`.

## Out of scope

- The announcement (03l) and the theme colour (03k).
- The strip and the sheet (03g).
- Any change to the hero transition or to ordinary-turn motion.
- Motion durations beyond the tokens already defined (owner decision 1).

## Comments
### Agent, implementation (Agent modes issue 03j, 17 Nov 2026)

**Owner decisions applied.** (1) `--duration-base` with `--ease-standard`; reduced motion starts no transition (JS) and the rules sit under `no-preference` (CSS). (2) Root cross-fade for the transcript, and the named elements: app bar (`.ui-appbar`, `app-bar`), composer (`form#composer`, `composer`), persona (`.mode-mark`, `persona`, present with two or more modes). (3) `withAgentMarkTransition` and its guard are unchanged. (4) The rules are in the "Guest UI kit" block of `shortlet-foundations.css`, tokens only, no formatter run.

**ADR and rule table.** Read: 0107 (decisions 2, 6, 7, 9), 0078 (reduced motion, 320 px reflow, no overflow during or after a transition, 44 px), the 03g, 03i, 03k and 03l Comments, AGENTS.md (Browser support, Guest UI work), coding standards, UX guidelines section 12.

| ADR | Constraint | Where it lands |
| --- | --- | --- |
| 0107 decision 7 | Typed `mode-switch`, feature-detected, skipped under reduced motion, instant update always correct. | `apps/local-guest/src/mode-switch-transition.ts` (`runModeSwitch`: typed, then untyped, then instant). |
| 0107 decisions 2 and 6 | Only a validated response changes the mode. | `applyResponseMode` (`client.ts`): the transition runs only when `modeSwitchChanges` says the validated id differs from `data-mode`. A preview, a chip or the sheet before the answer never reaches it. |
| 0107 decision 9 (motion) | `transform` and `opacity` only; nothing loops. | Cross-fade on opacity only, finite, `--duration-base`. |
| 0078 | Reduced motion; no overflow during or after a transition; 44 px. | Real Chrome AC9 (375 px, typed and untyped) and the captures. |
| AGENTS.md Browser support | Feature detection and graceful degradation. | `Reflect.apply(startViewTransition)` only when the function exists; typed call, then untyped, then instant. |

**How it is built.**
- Pure helper `mode-switch-transition.ts`: `modeSwitchChanges`, `runModeSwitch(update, environment)`, `MODE_SWITCH_TYPE`. Node-importable; the start function is passed in. Promise rejections from a transition are read, so a throwing update is not an unhandled rejection.
- `client.ts` glue stays thin: `modeSwitchEnvironment()` reads `startViewTransition`, `prefers-reduced-motion` and `document.activeViewTransition`. `applyResponseMode` builds one `update` (the data-mode and theme-colour write, empty copy, mark, strip) and runs it through the helper. The announcement (03l) and the server mode state stay synchronous and unchanged.
- The update writes only when this response's validated mode is still the committed one (`appliedMode.id === committed.id`), so a pending update never overwrites a later switch. An absent or malformed mode writes nothing (ADR 0107 decision 6). `appliedMode` starts at stays regardless of the server-rendered `data-mode`, which is why this gate matters on a restored shop page.
- `holdModeSwitchForFirstMessage`: a first message that commits a previewed mode (`commitPreviewThenSend`) keeps its switch instant, so the hero transition runs exactly as before and the two never overlap on that path. The hero guard is unchanged.
- Overlap guard: a switch never starts while `document.activeViewTransition` is set.

**Red runs (recorded before the code).**
- Node, before the module existed: `npx tsx --test test/agent-mode-view-transition.test.ts` gave tests 1, pass 0, fail 1 (`ERR_MODULE_NOT_FOUND`).
- Real Chrome, on the pre-build bundle (the committed client, before `npm run build`): `npx tsx --test test/agent-mode-view-transition-chromium.test.ts` gave AC1 failing (timeout: no transition was ever recorded, so no typed call happened). AC10 and AC3 passed on that bundle; they guard existing behaviour and were not red states. Recorded plainly, not inferred.

**Commands and counts (every command prefixed `env -u LLM_API_KEY`, final tree).**
- `npm run check`: exit 0 (after the last source change).
- `npx tsx --test test/agent-mode-view-transition.test.ts`: tests 9, pass 9, fail 0 (AC1 to AC8, plus the overlap guard).
- `npx tsx --test test/agent-mode-view-transition-chromium.test.ts` (solo): tests 4, pass 4, fail 0 (AC1 with AC9 at 375 px; AC9 fallback, the untyped form when the typed call throws, at 375 px; AC10 reduced motion; AC3 hero path untyped).
- Solo, one after another, on the final bundle: `test/agent-mode-sheet-chromium.test.ts` pass 5 of 5; `test/agent-mode-theme-color-chromium.test.ts` pass 2 of 2; `test/agent-mode-lane-cache-chromium.test.ts` pass 3 of 3; `test/agent-mark-chromium.test.ts` pass 5 of 6, failing AC10 "tier C: a busy task event leaves a restored suggestion chip" (see below).
- Listed node set: `npx tsx --test test/agent-mode-announcement.test.ts test/agent-mode-theme-color.test.ts test/agent-mode-lane-cache.test.ts test/agent-mode-follows-task.test.ts test/agent-mark-shell.test.ts test/shortlet-ui-foundations.test.ts test/guest-retired-classes.test.ts test/shortlet-design-system.test.ts test/assistant-cold-journey.test.ts test/agent-mode-view-transition.test.ts`: tests 75, pass 74, fail 0, skipped 1. The skip is pre-existing in `shortlet-ui-foundations` (gated by `SHORTLET_FOUNDATIONS_BROWSER=1`).
- Every other node test that reads `client.ts`, `dist/client.js` or the foundations CSS (35 files, from grep, minus the Chrome files): tests 257, pass 256, fail 1. The one failure is `test/landing-page.test.ts` AC8, which compares the uncommitted diff of `shortlet-foundations.css` with the index. It is expected until this change is committed (re-run after the commit, see below).
- Build: `npm run build` twice. Unrelated output (`apps/cloudflare/public/_headers`, `dist/gallery.js`, `landing.js`, `offer.js`, `payment.js`) restored with `git checkout --`. Only `dist/client.js` is committed from dist.
- Full `npm test` and `npm run test:workers` are not run here (batch gate).

**agent-mark tier C failure (not caused by this issue).** The test clicks a quick reply after a rail switch. 03i's `enterLane` removes the quick replies from the lane being left (`stripLaneControls`) before any server response, so the chip is gone before any mode-switch code runs. Run against the committed bundle (`git show HEAD:apps/local-guest/dist/client.js` temporarily in place, then my bundle restored byte for byte), the same assertion fails at the same line. A 03i-era test expectation to triage; outside this batch's scope.

**Deviations, recorded.**
1. **03k test expectation changed.** `test/agent-mode-theme-color.test.ts` AC6 matched the call text `readModeTint, response.mode`. The call now passes the response's validated mode (`committed`), inside the update. The single call site and the no-write-when-unchanged rule are unchanged. Reason: the update runs after the response, so the value must be the response's own validated copy, gated by the committed-id check above.
2. **Hero guard unchanged** (no code change in `withAgentMarkTransition`). The overlap is avoided by holding the switch on first-message commits and by the `activeViewTransition` check, not by editing the hero.
3. **Focus (brief: "the 03i focus move after the update").** The 03i focus move is not moved. On a rail switch it happens at the click (`enterLane`, then `routeHeading.focus()`). On a sheet or strip commit it happens in `renderTaskRail`, then `syncLanes`, then `enterLane`, which runs before `applyResponseMode` schedules the update. The update itself never moves focus. Owner to confirm this reading. Making it literal means reordering `renderResponse`, which 03i, 03k and 03l depend on, so I did not.
4. **Transcript cross-fade (owner decision 2), limit found.** `startViewTransition` captures the old snapshot at the next frame, not at the call (spec timing; not measured in headless Chrome). The response's turn and lane changes are applied synchronously before that, so they land in the old snapshot too. What visibly cross-fades is what the update changes: the mode copy, the strip, the mark and the theme colour. The new turn itself does not fade. Making the transcript fade would mean moving the response's DOM work into the update, the restructure the brief rules out. Owner to decide.
5. **Untyped fallback.** The mode-switch rules do not match an untyped transition, so the browser's default root animation applies, and the hero rule (`::view-transition-old(root) { animation: none }`) also applies. Real Chrome shows no overflow during or after that path at 375 px (AC9 fallback). It is not dropped.
6. **Overlap guard limit.** The guard reads `document.activeViewTransition`. Where that property is missing it reads "nothing running", so on a browser without it a switch could in theory start over a running transition. Accepted: the typed and untyped calls are feature-detected, and this only changes the visual, never the mode.
7. **Readiness check.** The Chrome recorder checks `transition.ready` as well as `finished`, so a skipped transition is caught.
8. **Line endings.** `client.ts`, `shortlet-foundations.css` and the 03k test keep CRLF in the working copy, as before. The new files are LF, as the other new test files are.

**Captures (not committed).** `.scratch/agent-modes/screenshots/03j/`: `switch-{320,390,768,1280}-{light,dark}.png` and `findings.txt`, taken with `.scratch/agent-modes/capture-03j.ts` (untracked, not committed). Each capture is a fresh tab, a sheet commit from stays to shop, then a 3 s settle and two animation frames. Findings: 8 of 8 have no horizontal overflow and no control under 44 by 44 CSS px. An earlier pass showed stale frames and a sheet still open. The cause was my capture script reusing a thread that had already started in shop, so the second choice was a no-op. Fixed with a fresh tab per capture; the captures above are from the final bundle.

**Definition of Done.** (1) Each AC has a `test()` in `test/agent-mode-view-transition.test.ts` (AC1 to AC8) or `test/agent-mode-view-transition-chromium.test.ts` (AC9, AC10, plus the fallback and hero cases); AC7 and AC8 are stylesheet tests. (2) Failure paths: the typed throw and the both-throw path (AC4), reduced motion (AC3), an unchanged or malformed mode (AC5), the overlap guard. (3) ADRs listed above. (4) No injected dependency beyond what the helper uses. (5) No invented policy: the timing is the owner's token. (6) No credentials, no logs. (7) `npm run check` passes; `npm test` is deferred to the batch gate.

**Status.** Resolved. Committed on `feat/agent-modes-03j`. Open for the owner before merge: deviations 3 (focus reading) and 4 (transcript cross-fade), and the pre-existing agent-mark tier C failure.

- Owner, 17 Nov 2026: accepted as built that the transcript does not cross-fade (the response chat changes land before the old snapshot; the mode copy, strip, mark and theme colour fade, the named app bar, composer and persona stay). Accepted that focus moves to the lane heading before the transition update (03i rule; the update never moves focus). Orchestrator check: npm run check exit 0; agent-mark-chromium 6/6, agent-mode-view-transition-chromium 4/4 solo; node set 50/50.
