# Stop the real-browser tests failing under full-suite load

Status: resolved
Type: task
Blocked by: none
Found in: B7 review (28 Sept 2026)

## Problem

The two-tab real-browser tests failed under load in four of five full `npm test` runs before M4. It was a different test each time, and each one passed when run alone. That makes `npm test` red for reasons that have nothing to do with the code, and it weakens Definition of Done item 7.

Seventeen test files drive a real Chrome over CDP through `launchRealBrowser` in `test/helpers/chrome-devtools.ts`. The most exposed is `test/guest-real-browser-cross-tab.test.ts` (RB1–RB12). `node --test` runs the other roughly 150 test files alongside them, several at a time.

## Acceptance criteria

- AC1: The cause is identified from failing full-suite runs, not guessed.
- AC2: Five consecutive full `npm test` runs pass with no real-browser failure. Otherwise, every test that is still flaky is quarantined behind an explicit, documented opt-in and listed here with its cause.
- AC3: No test loses coverage silently. Any timeout that was raised is justified by a measurement.

## Answer

**Causes (AC1).** These were found in failing full-suite runs on 28 Sept 2026.

1. **CPU contention.** The browser files already take turns on one Chrome (the lock in `chrome-devtools.ts`), but they ran alongside about 150 other files. A baseline run failed RB4, which timed out on "Check payment status" after 87 seconds. It also failed `pilot-local` AC4: `spawnSync` of `pilot:start` hit its 10-second timeout before printing `PAYSTACK_SECRET_KEY`.
2. **An eager diagnostic in `pilot-local` (AC27).** `assert.equal(opened, true, await tab.evaluate("document.body.innerText"))` evaluated its message on every pass. It ran just after the click had started a navigation, when `document.body` was null.
3. **A focus race (RB8).** It happened even with nothing else running. When a workspace surface renders, it moves focus to itself one animation frame later (`apps/local-guest/src/client.ts`). `focus()` in the helper focused once and then only polled, so the app's later move could win.
4. **Hidden misses.** The RB setup steps ignored `clickButton`'s result. A missed click therefore surfaced later as an unrelated text timeout.

**Changes.**
- `npm test` is now `node scripts/run-tests.mjs`. Phase 1 runs the non-browser files concurrently. Phase 2 runs every file that calls `launchRealBrowser` with `--test-concurrency=1`. Files are chosen by their content, so new browser tests join phase 2 automatically. `AGENTS.md` is updated to match.
- `pilot-local`: the page body is read only when the link is missing.
- The helper's `focus()` re-applies focus on each poll and requires it to hold across two consecutive polls. A persistent trap still fails, and the error names the element that has focus.
- In the RB setup steps, every click goes through `click()`, which asserts that the button was found.

**AC2.** Five consecutive full `npm test` runs passed with 0 failures, taking 526, 558, 551, 568 and 555 seconds. The old single-phase run took about 885 seconds. Nothing is quarantined.

**AC3.** No timeout was raised, and no test was removed or skipped.

## Comments

- 28 Sept 2026: while diagnosing, I found idle, orphaned `tsx --test` process trees from 27 Sept (PIDs 27460 and 26060, with workers). They used no CPU and held no browser lock, so they did not cause these failures. They were left in place for the user to decide on.
- 28 Sept 2026 (while doing issue 11): one full run failed RB5 in phase 2. The guest client showed "The concierge is temporarily unavailable" on the first `/api/turn`: the client's `AbortSignal.timeout(10_000)` ran out, or the server returned an error status. No Gemini variables were set, so the concierge was deterministic.
  - The machine was at about 43% CPU with no test running, from load outside this repo.
  - RB5 passed three runs of the file alone (12/12 each time), and the next full run was fully green.
  - Watch for it: if it recurs, log the `/api/turn` status and duration in `sendPrompt` before changing any budget.
