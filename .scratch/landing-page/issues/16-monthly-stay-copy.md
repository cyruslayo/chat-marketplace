# 16 · Landing page: say that stays run from a few nights to 6 months

Status: resolved
Type: task
Blocked by: none
Requested: 8 Nov 2026

## Why

Issue 13 item 4 kept the page to 1–14-night stays "until counsel signs off". Counsel approved ADR 0092 on 1 Nov 2026 and Extended Stays (30 to 180 nights, 1 to 6 months) are on in every deployment. The owner approved the monthly positioning and the copy below on 8 Nov 2026 (recommendations from the landing copy assessment).

## Approved copy (use exactly; all within the slot limits in `LANDING_LENGTH_LIMITS`)

| Slot (`LANDING_COPY`) | New text |
|---|---|
| `heroEyebrow` | Furnished apartments · by the night or month |
| `heroLede` | Say what you need, for a few nights or a few months. See only what you can book, at the full price. Your money stays yours until it’s confirmed. |
| `composerPlaceholder` | Where, for how long, and who’s coming? |
| `exampleChips[2]` (replaces "Ikoyi, 2 weeks from 10 Sept") | Ikoyi, 60 nights from 5 Jan, relocating (nights: 60) |
| `howEyebrow` | How it works · one stay, five screens |
| `closingHeading` | Start with the stay, not the form. |
| `pageTitle` | Shortlet · Lagos and Abuja apartments, nights or months |
| `moneyCards[2].body` | Once payment is verified, the Reservation is confirmed. Staying a month or more? You pay 30 nights at a time, each on its own due date. |
| New FAQ entry, after "And if the Operator says no?" | Q: Can I stay for a month or longer? A: Yes, from 30 nights up to 6 months, in apartments that offer it. You pay the first 30 nights to confirm, then each later 30 nights by its own due date. |

**New band "Staying for months?"** placed after the money section, built only from existing kit components and semantic tokens (AGENTS.md "Guest UI work"; no new component, no hex, no `style:` strings):
- H2: "Staying for months? *Pay one month at a time.*" (the second sentence is the italic accent, like the other headings)
- Line: "Not a hotel bill for three months. Not a year paid upfront before you know the city."
- Three facts: "One monthly price, all-in." · "Each apartment lists what’s included: power, water, internet, cleaning." · "30 nights at a time, never more than one period ahead."
Add length limits for the new slots (H2 55, line 130, fact 70) and test them like the others.

## Rules

- **Chip validator.** `validateExampleChips` must accept any Short Stay (1–`MAX_STAY_NIGHTS`) or Extended Stay length (the policy's 30–180), and refuse 0 and 181+, with a message naming both ranges. Import from the domain index only.
- **Chip must work end to end.** The concierge reads "60 nights" but has no month parser, which is why the chip says nights. Add a test that sending the chip text from the landing handoff (issue 14 path) on a production-like composition yields a 60-night search, not a nights clarification. Do not add a month or keyword parser (ADR 0106).
- **Forbidden terms.** Add `rent`, `lease`, `tenant`, `tenancy` and `landlord` to `LANDING_FORBIDDEN_TERMS` (ADR 0092 guest wording), as whole words. "upfront" is fine.
- **Do not change** other slots, the trust strip, the beats, the approved FAQ answers, or the demo notice. The phone and chat mock screens are not marketing copy (ADR 0077).
- Record in landing issue 13 Comments that item 4 is superseded by this issue.

## Acceptance criteria

- AC1: Every slot in the table renders exactly the approved text, within its length limit.
- AC2: The "Staying for months?" band renders its H2, line and three facts using kit components only, and passes the foundation/retired-class tests.
- AC3: The chip validator accepts 29, 30, 60 and 180 nights and refuses 0 and 181.
- AC4: The 60-night chip, sent through the landing handoff, produces a 60-night search on a production-like composition.
- AC5: No landing copy contains a forbidden term, including the five new ones.
- AC6: ADR 0078 checks pass (no horizontal overflow, 44px targets, light and dark); captures at 320, 390, 768 and 1280 under `screenshots/16/`.

## ADR compliance

| ADR | Constraint |
|---|---|
| 0092 (amended) | 30–180-night Extended Stays; no tenancy wording |
| 0023 (amended) | 1–29-night Short Stays |
| 0077 | One source for guest wording |
| 0078 | Accessible launch profile |
| 0106 | No keyword shortcuts around the model |

## Definition of Done

See `docs/agents/issue-tracker.md` and AGENTS.md "Guest UI work". Record commands and pass counts in Comments.

## Comments

### Implementation — 8 Nov 2026

**Files.** `apps/local-guest/src/landing-copy.ts` (approved slots, the "Staying for months?" copy, the FAQ entry, the chip validator, the length limits, the five forbidden terms); `apps/local-guest/src/landing-page-html.ts` (`monthsSection()` placed after the money section); `apps/web/src/shortlet-landing.css` (`.landing-months__facts` and `.landing-months__fact`, tokens only; FAQ answer measure 60ch to 56ch); `test/landing-monthly-copy.test.ts` (new, one test per AC1 to AC6); `test/landing-chip-limit.test.ts` and `test/landing-page.test.ts` (updated only where they asserted the replaced behaviour: 30-night refusal, the 1–14/1–29 chip wording, the 60ch measure, the approved chip list, the import regex); `.scratch/landing-page/issues/13-stays-launch-landing-decisions.md` (supersede line); `.scratch/landing-page/map.md`; `.scratch/landing-page/screenshots/16/` (new captures and `findings.txt`).

**Decisions made and why.**
- Chip text: the table's "(nights: 60)" is read as the nights value, not chip text. The chip text is "Ikoyi, 60 nights from 5 Jan, relocating" with `nights: 60`; with the parenthesis it is 52 characters, over the 45 chip limit in AC1.
- Fact length: "Each apartment lists what’s included: power, water, internet, cleaning." is 71 characters, over the 70 limit given in the issue. The owner approved the copy as written, so the copy is unchanged and the `monthsFact` limit is 75. **Owner decision needed if the limit should stay at 70**, which would mean changing the approved copy.
- Prose line (Issue 04 AC7): the approved FAQ answer "Yes, from 30 nights up to 6 months…" wrapped to 76 characters at 1280. The FAQ answer measure goes from 60ch to 56ch (a FAQ-only change, and the static assertion in `landing-page.test.ts` moves with it). The longest line is now 72 characters.
- Band classes: the band reuses the section intro and `ui-icon` from the kit. One small new landing facts list (`landing-months__facts`) is added, since the trust strip grid is four columns and would leave a gap with three facts.
- AC4 is an HTTP test on the issue 14 path (`POST /welcome/start`, demo off), with a cold restore (a new server over the same database) before the conversation is read. The reply reads "Old Ikoyi, Lagos · Tue 5 Jan 2027 to Sat 6 Mar 2027 · 60 nights" and asks only for the guest count. No month or keyword parser was added.

**ADRs applied.** 0092 (amended): 30–180-night Extended Stays, no tenancy wording (the five forbidden terms). 0023 (amended): 1–29-night Short Stays (`MAX_STAY_NIGHTS`). 0077: one copy source in `landing-copy.ts`. 0078: captures at 320, 390, 768 and 1280, light and dark, no overflow, controls at 44px. 0106: no keyword shortcut around the concierge (AC4 asserts the model's reply, with no parser added). 0075: the handoff body only, unchanged.

**Commands and results.**
- `env -u LLM_API_KEY npm run check`: exit 0 (before the commit; re-run on the committed tree below).
- `env -u LLM_API_KEY NODE_ENV=test COMMERCE_REFERENCE_TEST_KEY=allow npx tsx --test test/landing-monthly-copy.test.ts test/landing-chip-limit.test.ts test/landing-page.test.ts test/demo-mode-landing.test.ts test/guest-retired-classes.test.ts test/shortlet-ui-foundations.test.ts test/landing-port.test.ts test/landing-handoff.test.ts`: 62 tests, 61 pass, 0 fail, 1 skipped (final run, after the FAQ measure and assertion update). Before the captures existed, AC6 was the only failure.
- Under `flock` with `SHORTLET_CHROME_PATH=/usr/bin/google-chrome`: `capture-landing.ts 16`: 10 PNGs plus `findings.txt`, document overflow none, controls under 44px 0, text under 12px 0, longest prose line 72.
- Under `flock`: `npx tsx --test test/landing-page-chromium.test.ts test/landing-monthly-copy.test.ts`: 50 tests, 48 pass, 1 fail, 1 flake. The fail was Issue 09 AC5 (app bar solid after scroll); it passed solo (2 of 2) under the lock and passed in the first run. No app bar CSS changed. Recorded as a load flake, not a regression.
- `env -u LLM_API_KEY npm run build` then `env -u LLM_API_KEY npm run test:workers -- apps/cloudflare/test/landing-assets.spec.ts`: 3 of 3 pass.

**Not done / notes.**
- The build regenerated `apps/local-guest/dist/client.js` and some existing `.scratch/landing-page/screenshots/11/*` files. Neither is committed; they remain unstaged in the worktree.
- Full `npm test` is not run (per-issue scope; it runs in the batch gate).
- Owner items: the 70 vs 75 fact limit (above); the approved chip text reading of "(nights: 60)".

8 Nov 2026: owner replaced the composer placeholder with “Where, how long, how many?” because the approved line was truncated at 320px.
