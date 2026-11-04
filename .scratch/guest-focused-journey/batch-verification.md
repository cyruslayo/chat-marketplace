# Batch verification

Base: `22fe11b`.

The parent reported 174/193 passing Worker tests, with 19 timeouts across seven files.
Isolated reruns passed except daily-export D3: eight of nine passed, with D3 taking 6,566ms against its 5,000ms limit.
AGENTS.md directs agents to raise this known test timeout.

Only the multipart-export D3 test now uses a 15,000ms timeout.
Its assertions and production code remain unchanged.

Command: `npm run test:workers -- apps/cloudflare/test/daily-export.spec.ts`.
Result: one file passed; nine tests passed, zero failed. The Worker bundle guard also passed.
Vitest reported 134.49 seconds total, including 65.50 seconds for tests.
Source-map warnings did not fail the run.

This isolated pass resolves the documented daily-export timeout.
It does not replace the remaining full batch verification.

## Focused journey browser checks

Baseline `9d1eef3` failed these isolated checks before the test changes.

| Command | Passed | Failed |
| --- | ---: | ---: |
| `npx tsx --test test/guest-new-conversation-chromium.test.ts` | 1 | 1 |
| `npx tsx --test --test-name-pattern 'Escape closes the focused workspace\|Receipts render as markers\|A free-text turn with a live surface open\|successful Guest journey works at 320 pixels' test/mobile-guest-journey-chromium.test.ts` | 0 | 4 |
| `npx tsx --test --test-name-pattern 'Production pilot:start\|local pilot smoke passes' test/pilot-local.test.ts` | 1 | 2 |

The phone tests open the conversation with Ask Shortlet before using its controls. Desktop still tests Escape with the composer visible alongside the task.

The pilot smoke tests query the saved contact row for the entered phone number and verify its email. They also check the confirmation page and viewport.

ADR 0078 applies to visibility, focus, and viewport checks. ADRs 0004 and 0074 apply to saved contact state and the current task surface.

Verification used the detached worktree `C:/AI2026/chat-marketplace-guest-focus-correction`. Browser commands ran one at a time. The detached worktree received the mobile captures.

| Command | Passed | Failed |
| --- | ---: | ---: |
| `npx tsx --test test/guest-new-conversation-chromium.test.ts` | 2 | 0 |
| `npx tsx --test --test-name-pattern 'Escape closes the focused workspace\|Receipts render as markers\|A free-text turn with a live surface open\|successful Guest journey works\|Mobile fixes do not duplicate transition telemetry\|desktop viewport remains usable\|booking/payment journey works at a true 768px\|Pending payment stays unconfirmed' test/mobile-guest-journey-chromium.test.ts` | 11 | 0 |
| `npx tsx --test --test-name-pattern 'Production pilot:start\|local pilot smoke passes' test/pilot-local.test.ts` | 3 | 0 |

`npm run check` passed in the working branch, including the Worker bundle guard. The full batch gate remains pending.

### Keyboard activation follow-up

The mobile tests now focus Ask Shortlet and Return before they press Enter. This checks that both controls are available to keyboard users.

In the detached worktree, a temporary probe set Ask Shortlet to `display: none !important` before focus. The receipt case failed at the expected focus step. The probe was removed before the normal run.

| Command | Passed | Failed |
| --- | ---: | ---: |
| `npx tsx --test --test-name-pattern 'Receipts render as markers' test/mobile-guest-journey-chromium.test.ts` with the probe | 0 | 1 |
| `npx tsx --test --test-name-pattern 'Escape closes the focused workspace\|Receipts render as markers\|A free-text turn with a live surface open\|successful Guest journey works\|Mobile fixes do not duplicate transition telemetry\|desktop viewport remains usable\|booking/payment journey works at a true 768px\|Pending payment stays unconfirmed' test/mobile-guest-journey-chromium.test.ts` | 11 | 0 |

`npm run check` passed, including the Worker bundle guard.

### Keyboard reopen after the server check

The isolated full mobile file at `7b21fd8` passed 42 of 43 tests. AC29 read the task visibility immediately after Enter, before the server state check completed. The original named case passed when run alone in the working branch.

AC29 now pauses a real state request and checks that the task stays hidden. It then verifies the same active surface, enabled action, focus, and restored scroll.

| Command | Passed | Failed |
| --- | ---: | ---: |
| `npx tsx --test test/mobile-guest-journey-chromium.test.ts` at `7b21fd8` | 42 | 1 |
| `npx tsx --test --test-name-pattern 'AC29 — Focused workspace closes and reopens from the keyboard' test/mobile-guest-journey-chromium.test.ts` before the change | 1 | 0 |
| `npx tsx --test --test-name-pattern 'AC29 — Focused workspace closes and reopens from the keyboard' test/mobile-guest-journey-chromium.test.ts` after the change | 1 | 0 |

`npm run check` passed, including the Worker bundle guard.

`npx tsx --test test/guest-focused-phone-shell-chromium.test.ts` passed 7/7. It covers stale, expired, superseded, and failed state responses.

### Focus after surface replacement

At `b94a01c`, the isolated mobile file passed 42 of 43 tests. AC14 read focus immediately after the detail text appeared. The renderer moves focus on the next animation frame.

AC14 now waits for focus on the visible, enabled Back button inside the open Unit detail. This checks the renderer's focus behavior under ADR 0078.

| Command | Passed | Failed |
| --- | ---: | ---: |
| `npx tsx --test test/mobile-guest-journey-chromium.test.ts` at `b94a01c` | 42 | 1 |
| `npx tsx --test --test-name-pattern 'AC14 — Surface replacement preserves usable focus' test/mobile-guest-journey-chromium.test.ts` after the change | 1 | 0 |

A supplemental animation-frame probe stalled before it reported a test result. The named run used the unmodified browser scheduling. `npm run check` passed, including the Worker bundle guard.

### Shared browser lock publication on Windows

The full gate at `a1fe3c5` recorded 44 `EBUSY` rename errors while publishing the shared browser lock. The four affected browser files passed in isolated reruns.

The harness now retries an `EBUSY` rename through the existing lock wait deadline. It still publishes the candidate by atomic rename and checks the owner before takeover or release.

| Command | Passed | Failed |
| --- | ---: | ---: |
| `npx tsx --test --test-name-pattern 'EBUSY publishing\|unexpected candidate publication' test/browser-lock.test.ts` before the fix | 1 | 2 |
| `npx tsx --test test/browser-lock.test.ts test/browser-attach.test.ts test/browser-phase-aggregate.test.ts test/browser-phase-timeout.test.ts test/chrome-devtools-config.test.ts` after the fix | 41 | 0 |

The tests simulate transient and persistent `EBUSY` and an unexpected `EACCES` from the candidate rename. They verify bounded failure, successful acquisition on the same path, and preservation of the live owner.

`npm run check` passed, including the Worker bundle guard.

`npx tsx --test test/guest-new-conversation-chromium.test.ts` passed 2/2 with the default shared lock path and no temp-directory override. This run exercised ordinary browser acquisition and release.
