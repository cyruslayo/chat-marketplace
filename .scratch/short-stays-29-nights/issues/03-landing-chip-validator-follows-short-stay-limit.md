# 03 · Landing chip validator follows the Short Stay limit

Status: resolved
Type: task
Blocked by: 01
Requested: 1 Nov 2026

## What to build

`apps/local-guest/src/landing-copy.ts` keeps its own `LAUNCH_MAX_STAY_NIGHTS = 14` and `validateExampleChips` refuses chips over it, citing ADR-0023. Make the landing take the limit from the domain instead of a copy of it.

- Remove `LAUNCH_MAX_STAY_NIGHTS` and use `MAX_STAY_NIGHTS` from `domains/shortlet/src` (or re-export it under the old name if other modules import it; search first).
- Update the validator message to "a Short Stay is 1 to 29 nights (ADR 0023)".
- Do **not** change any chip text or other landing copy here. Copy changes, including monthly chips of 30+ nights, wait for the landing copy decision (landing issue 13 item 4, to be reopened).

## Acceptance criteria

- AC1: `validateExampleChips` accepts a chip of 29 nights and refuses one of 30 nights and one of 0 nights, naming the 1–29 range.
- AC2: The landing module has no stay-length constant of its own; the limit comes from `MAX_STAY_NIGHTS`.
- AC3: The approved chips and the landing copy tests (`test/landing-page.test.ts`) pass unchanged.

## ADR compliance

| ADR | Constraint | Where it bites |
|---|---|---|
| 0023 (amended) | Short Stay 1–29 nights | AC1, AC2 |
| 0077 | One source for guest wording and rules | AC2 |

## Definition of Done

See `docs/agents/issue-tracker.md`. Record the exact test commands and pass counts in Comments.

## Comments

- 1 Nov 2026 (agent, issue 03). Files: `apps/local-guest/src/landing-copy.ts` (removed `LAUNCH_MAX_STAY_NIGHTS`; imports `MAX_STAY_NIGHTS` from `domains/shortlet/src/browse.js`; message now "a Short Stay is 1 to 29 nights (ADR 0023)"; no other importer of the old name existed, so nothing was re-exported); `test/landing-chip-limit.test.ts` (new: AC1, AC2, AC3 each one named `test()`); `test/landing-page.test.ts` (the Issue 08 AC8 test asserted that a 15-night chip is refused, which is now valid, so its title moves to 1–29 and its refused example becomes 30 nights; the approved chips and all other landing assertions are unchanged); `test/guest-criteria-strip-chromium.test.ts` (Part B: the out-of-range example is now 181 nights and the expected message is the 180-night sentence, mirroring `test/guest-criteria-strip.test.ts` AC3).
- Test runs (`env -u LLM_API_KEY`):
  - `npx tsx --test test/landing-chip-limit.test.ts test/landing-page.test.ts test/demo-mode-landing.test.ts test/demo-mode-guest.test.ts`: 42 pass, 0 fail (3 new, 33 in landing-page, 6 in the two demo-mode files).
  - `npx tsx --test test/guest-criteria-strip-chromium.test.ts`, run alone: first attempt failed with `spawn C:\Program Files\Google\Chrome\Application\chrome.exe ENOENT` (the helper's Windows default, `test/helpers/chrome-devtools.ts`). Re-run with `SHORTLET_CHROME_PATH=/usr/bin/google-chrome`: 2 pass, 0 fail. No code changed for the environment.
  - `npm run check`: exit 0, on the tree with the changes above.
- Part B result: the Chromium out-of-range case now types 181 nights and waits for "Stays can be at most 180 nights. Please choose 180 nights or fewer."; it passes.
- Acceptance: AC1 (`AC1: validateExampleChips accepts ...`) passes; AC2 (`AC2: The landing module has no stay-length constant ...`) passes; AC3 (`AC3: The approved chips ...`) passes with the landing page suite unchanged apart from the AC8 failure-path case noted above.
