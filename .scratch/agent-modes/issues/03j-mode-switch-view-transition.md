# Animate a mode switch with a feature-detected, typed View Transition

Status: needs-triage
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
