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
