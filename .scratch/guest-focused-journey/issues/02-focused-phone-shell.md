# 02 Focused phone shell

Status: resolved
Type: task
Blocked by: 01

## What to build

On phones, a current booking task fills the available view with one scroll owner, contextual Back, compact current-stage label, and one primary action. “Ask Shortlet” opens chat while preserving the message draft and task scroll. Browser Back and visible Back agree. Desktop retains the existing split. Update the guest kit direction for approved app-bar and rail changes.

## Acceptance criteria

- AC1: A focused task on a 320 or 390-pixel phone shows one task scroll area, visible status, and current action without a persistent composer or obstructed content.
- AC2: Ask Shortlet and return preserve an unsent draft, the task state and scroll position, and predictable keyboard focus.
- AC3: Browser Back, visible Back, reopen, and cold restore return to the same safe current task; stale or unknown surfaces cannot regain an enabled action.
- AC4: Desktop keeps the conversation and workspace split, and conventional routes retain the same facts and actions.

## ADR map

0074: stale surface lifecycle fails closed. 0077: channel facts stay canonical. 0078: 320px, focus, targets, reduced motion and keyboard. 0080: conventional parity. 0106: cold restore and stable ids. Read other intersecting ADRs before code.

## Tests and evidence

Write one named failing test per AC. Cover open/close, Back, restore, draft, focus, and scroll. Run `npm run check` and affected tests. Run one changed real-Chrome file at a time. Capture 320/390/768/1280, light/dark, and check target size and overflow. Record exact commands and counts in Comments and complete the Definition of Done.

## Comments

- ADR review: 0005 retains Request to Book; 0015/0016 retain canonical total and separate deposit; 0041/0044 retain request and payment windows; 0049 retains hosted checkout. This shell changes none of those rules. 0068/0072/0073 keep A2UI actions behind validated platform commands. 0074 and 0106 require current server surfaces and fail-closed stale actions (AC3). 0075 bars sensitive content in logs (all criteria). 0077 and 0080 keep the same projected facts and conventional routes (AC4). 0078 requires 320px reflow, focus, keyboard, reduced motion, and 44px targets (AC1–3).
- Red evidence: `npx tsx --test test/guest-focused-phone-shell-chromium.test.ts` first ran with 2 passed and 2 failed. AC1 exposed the persistent composer. AC2 exposed the missing Ask Shortlet control. A later AC2 run exposed task scroll loss on return.
- Implementation: the focused task owns the phone viewport and scroll. Its contextual bar contains Back, a stage label, and Ask Shortlet. The existing kit action bar holds the primary action. Ask Shortlet and Back keep the task DOM and message draft. Reopen restores task scroll. Server refreshes remain authoritative, and stale or unknown surfaces cannot reopen an action. Desktop keeps the split.
- Named acceptance tests: `test/guest-focused-phone-shell-chromium.test.ts` has one test per AC. AC1 checks 320px and 390px layout and action visibility. AC2 checks draft, scroll, task, and focus. AC3 checks visible Back, browser Back, reopen, cold restore, and unknown/stale rejection. AC4 checks the desktop split and the conventional detail route.
- Focused checks passed: `npm run build`; `npm run check` (zero errors); `npx tsx --test test/local-guest-shell.test.ts test/conversational-shell.test.ts` (14 passed, 0 failed). The shell expects an empty state response for unknown threads. A refresh without surfaces keeps the retained task inert.
- Real Chrome checks passed, one file at a time: `npx tsx --test test/guest-focused-phone-shell-chromium.test.ts` (4 passed, 0 failed); `npx tsx --test test/guest-split-workspace-chromium.test.ts` (4 passed, 0 failed); `npx tsx --test --test-name-pattern='AC6|AC7|AC8|AC14|AC15|AC26|AC28|AC32' test/mobile-guest-journey-chromium.test.ts` (8 passed, 0 failed).
- Captures passed: `npx tsx .scratch/guest-focused-journey/capture-02.ts` wrote eight screenshots and `screenshots/02/findings.txt`. Widths were 320, 390, 768, and 1280 in light and dark themes. All eight had no horizontal overflow and no visible control below 44px. Visual inspection included 320px dark and 1280px light.
- Definition of Done review: AC1–AC4 each have a dedicated named test and the named failure paths above. The ADRs above were read. No constructor dependency, policy threshold, business rule, bearer log, or restricted identity record was added. `npm run check` and the affected tests pass. The full `npm test` and Workers suite remain the batch pre-merge gate under the project Test scope.
- Implementation commit: `b36b0dd`.
- Reviewer correction: two AC3 Chrome regressions first failed. A stale or expired same-surface refresh exposed a closed task; Return also exposed retained actions before checking another tab's superseding server state. The task now stays hidden while chat owns focus. Return checks the server with a disabled, busy control before any action becomes visible. A stale or expired task can reopen only as an inert view. A failed check marks the retained view stale. The message draft and task scroll remain in memory.
- Correction checks passed: `npm run build`; `npm run check` (zero errors); `npx tsx --test test/local-guest-shell.test.ts test/conversational-shell.test.ts` (15 passed, 0 failed); `npx tsx --test test/guest-focused-phone-shell-chromium.test.ts` (6 passed, 0 failed); `npx tsx --test test/guest-split-workspace-chromium.test.ts` (4 passed, 0 failed). The two real-Chrome files ran one at a time.
- Reviewer network correction: `AC3 regression: one failed current-state check opens an inert task with retry and preserves the draft` failed before the fix. After one failed state request, Return now opens the saved task as an inert view. It shows Retry current status and the server-provided standard route outside the inert mount. Retry rechecks the server before any action becomes available. `npm run check` passed; `npx tsx --test test/guest-focused-phone-shell-chromium.test.ts` passed (7 passed, 0 failed); `npx tsx --test test/guest-split-workspace-chromium.test.ts` passed (4 passed, 0 failed). The real-Chrome files ran one at a time.
- Reviewer focus correction: the failed-state Chrome test then exposed lost focus after a successful Retry replaced its button. Retry now focuses the refreshed task's Back control, or the composer when the new projection is not a focused task. The draft remains unchanged. The added focus assertion failed before the fix. `npm run check` passed; `npx tsx --test test/guest-focused-phone-shell-chromium.test.ts` passed (7 passed, 0 failed).
- Batch correction checks passed after the state response was restored.
- `npx tsx --test test/local-guest-shell.test.ts` passed 8/8. `npx tsx --test test/conversational-shell.test.ts` passed 7/7.
- `npx tsx --test test/guest-focused-phone-shell-chromium.test.ts` passed 7/7 in a separate run.

## Answer

The focused phone task now uses one scroll area and a contextual bar. Ask Shortlet preserves the draft and task position. Browser Back, visible Back, reopen, and cold restore keep the current safe task. Desktop and conventional routes retain their existing authority.
