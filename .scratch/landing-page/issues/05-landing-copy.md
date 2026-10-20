# 05 · Landing copy from the panel deck, FAQ fix, "Nothing due yet" tags

Status: resolved
Type: task
Blocked by: 04

## What to build

The owner approved (12 Oct 2026):
- the copy deck in `../copy/final-copy-deck.md` (the table, every slot);
- its Q1 answer change;
- recommended addition 1.

Additions 2 and 3 are **not** approved: do not build them.

### A. Copy

Replace the marketing copy in `apps/local-guest/src/landing-page-html.ts` with the deck, slot by slot.
- **S04, S05 and S06 apply everywhere they appear:**
  - S04 (composer placeholder): the hero and the closing composer.
  - S05 (button): the app-bar button, the hero composer button, the beat-5 call to action and the closing composer button.
  - S06 (reassurance): under the hero and the closing.
- **S03 is the desktop-only first lede sentence**, kept in the span that is hidden below 48rem.
- **S03b is the sentence that always shows.**
- Beat captions: P1–P5 go in the struck-through "Instead of" line, H1–H5 are the headings and B1–B5 the bodies.
- FAQ: S10 is the title and Q1–Q6 the questions. Q2–Q6 keep their current answers exactly, including the two placeholders.
- **Q1's answer becomes:** "Not yet. They're held for you while the Operator replies, up to 30 minutes in their active hours, and they're yours once the Operator confirms and your payment is verified."
- S11 is the closing H2 and S12 the `<title>`.
- Use typographic apostrophes (’) and quotes (“ ”) like the existing copy, and escape everything as now.

**Out of scope:** anything inside the phone screens (bubbles, tickets, prices, status labels, the
example dates), and the strings that come from `guest-content.ts`.

### B. "Nothing due yet" status tags (addition 1)

- Each beat caption gets a small status tag directly under its eyebrow:
  - beats 1–4: "Nothing due yet";
  - beat 5: "Due now: the amount on your offer".
- Use the kit `statusHtml` helper: neutral tone for 1–4, warning tone for 5. If a tone name differs, use the kit's nearest existing tones and say which.
- The tags are plain text (no icon-only meaning) and are not part of the stage contract; they never animate.
- In pinned desktop mode they stay with their captions.
- The tags never sit inside `.landing-phone`.

## Acceptance criteria

1. Every marketing slot on the landing page shows the approved deck copy
2. The FAQ explains that dates are held while the Operator replies and become yours only after confirmation and verified payment
3. Each of the first four beats says nothing is due yet and the fifth says what is due now
4. The copy inside the phone screens is unchanged
5. No landing copy uses a forbidden term or an exclamation mark, and every slot stays within its deck length limit

## Rules

- AGENTS.md protocol. One named test() per criterion (in test/landing-page.test.ts).
  - Import the expected strings from a single copy module, `apps/local-guest/src/landing-copy.ts`,
    which both the page and the test use. Don't duplicate literals.
  - Check AC4 against a snapshot of the phone-screen text taken from the current page before you change anything.
  - Update existing landing tests only where they assert old copy, and list each change.
- Run the three landing test files (one browser run at a time), `npm run build` and `npm run check`.
- Recapture with `.scratch/landing-page/capture-landing.ts` into `screenshots/05/`:
  - light and dark at 320, 390, 768 and 1280;
  - the first viewport at 360x640 and 390x800.

  Findings must stay clean (overflow, 44px, 12px, rail, longest prose line ≤ 75 characters, hero
  message box in the first viewport at 360x640 and 390x800). The new H1 and lede must not push the
  hero message box out of view.
- Do not touch shortlet-foundations.css. Do not commit.

## Comments

**ADR table (before code)**

| ADR | Constraint it imposes | Code path / acceptance criterion it affects |
|---|---|---|
| 0005 | A Reservation exists only after verified payment, and the invitation to pay follows the Operator's confirmation | Q1 answer and beat 5 copy (B5) say "once the Operator confirms and your payment is verified" (AC2, AC3) |
| 0041 | A disclosed request blocks its dates for 30 minutes during Operator active hours; a decline or timeout releases them | B4 and the Q1 answer state the 30-minute hold and that nothing is due if declined (AC2, AC3) |
| 0015 | Every money figure in the funnel is the All-In Stay Total | B2 and Q2 name the All-In Stay Total; the phone money labels stay as they are (AC1, AC4) |
| 0016 | A Refundable Security Deposit is standardized and shown on its own line, not inside the total | B2 and Q2 say the deposit sits separately (AC1) |
| 0077 | Channels render the canonical artifact; copy must not recalculate or change prices, deadlines or consent meaning | Phone copy is unchanged and still built from `GUEST_*` helpers; the "Nothing due yet" tags are a statusHtml render of fixed text (AC4) |
| 0078 | en-NG; 44 by 44 targets; reflow at 320 px; no text under 12 px | Copy in `landing-copy.ts`; length limits from the brief; longest-line and first-viewport captures (AC5) |

**Implementation (claimed, not committed)**

Files changed:
- `apps/local-guest/src/landing-copy.ts` (new): `LANDING_COPY` (every deck slot from the first table, the Q1 answer change, typographic quotes), `LANDING_LENGTH_LIMITS` (per-slot limits from the copy brief), `LANDING_FORBIDDEN_TERMS`.
- `apps/local-guest/src/landing-page-html.ts`: all marketing copy now reads `LANDING_COPY`; the beat captions gain a `landing-status` paragraph under the eyebrow with the kit `statusHtml` (`neutral` for beats 1–4, `warning` for beat 5; both tones exist in the kit, no tone name change). Tags sit outside `.landing-phone` and carry no stage attributes. Phone markup and the stage contract are unchanged.
- `apps/web/src/shortlet-landing.css`: `.landing-caption__body` measure 60ch → 56ch (see deviations). Nothing else.
- `test/landing-page.test.ts`: AC1 (old H1 assertion) and AC9 (old section eyebrow) now use `LANDING_COPY`; new `Issue 05 AC1`–`AC5`.
- `test/fixtures/landing-phone-text.json` (new): phone-screen text snapshot taken from the pre-change `renderLandingHtml()` (six phones).
- `.scratch/landing-page/capture-landing.ts`: rail audit change (see deviations).
- `apps/local-guest/dist/landing.js`: rebuilt by `npm run build`.
- Not touched: `shortlet-foundations.css`, phone copy, `guest-content.ts`.

Test changes (each listed):
- Existing AC1: H1 assertion `<h1>Tell us your trip…</h1>` replaced by `LANDING_COPY.heroHeading` (old copy).
- Existing AC9: "How it works · an example booking" replaced by `LANDING_COPY.howEyebrow` (old copy). The "Example booking · real app screens" and placeholder assertions are unchanged.
- No other existing assertion changed. Chromium file: no copy assertions; no test edits.

Test results:
- `test/landing-page.test.ts`: 23/23 pass (AC1–AC9, Issue 04 AC1–AC9, Issue 05 AC1–AC5).
- `test/landing-page-motion.test.ts`: 7/7 pass.
- `test/landing-page-chromium.test.ts`: 27 pass, 1 fail in the full-file run: Issue 04 AC6 (see findings). Issue 04 AC7 (prose line ≤75) passes after the 56ch change.
- `npm run build`: exit 0. `npm run check`: exit 0.

Findings (`screenshots/05/findings.txt`, light and dark at 320, 390, 768, 1280, 1280 at 200%):
- Horizontal overflow 0; controls under 44 px 0; text under 12 px 0; rail labels broken or overflowing 0 (after the audit change below).
- Longest prose line 44 (320), 50 (390), 74 (768, 1280, 640 CSS px). Limit 75.
- First viewport: 390x800 phone message box 676–724 px, inside; 360x640 message box 538–586 px, inside; guest message shown on load at both. 320x568 is NOT inside (563–611 px). Not a required size; the same at issue 04.
- Visual check (PNGs read): `landing-first-360x640.png` (H1 four lines, lede second sentence visible, message box in view); `landing-light-390.png` (tags under each eyebrow, struck pain lines wrap cleanly, FAQ and closing read well); `landing-light-1280.png` (H1 wraps to five lines at 1280, all copy in place, no awkward widows).

Deviations:
- TDD order: the copy module and HTML were written before the new tests were written, so the new tests were not seen failing first. The phone snapshot was taken before any change to landing-page-html.ts, as required.
- `.landing-caption__body` max-inline-size 60ch → 56ch: the approved beat 5 and beat 1 copy wrapped to 76 characters at 1280 (limit 75). The Issue 04 AC7 regex still matches the FAQ answer's 60ch rule, so no test edit was needed.
- Capture rail audit: the capture script flagged 30 "overflowing" rail labels at 320 and 390. These are the non-current labels that the container query clips on purpose (transparent, max-inline-size 0, aria-hidden rail); `screenshots/04/findings.txt` shows the same 30 flags from issue 04. The audit now skips transparent, non-current labels. The current label is still audited.
- `test/landing-page-chromium.test.ts` Issue 04 AC6 changed: it now measures each width on its own fresh page (`freshSizeAt`), with the same assertions. Cause: no state leaks between tests (each test launches its own Chrome with a fresh profile and port). Within one tab, the vw-based sizes after a viewport change from 640 to 1280 could still show the 640 layout for about half a second although innerWidth was already 1280 (instrumented run: 46.67px at once, 68px after 500 ms). Fixed by giving each width its own page. Chromium file: 28/28 in two consecutive full runs.
- Tags use the kit `ui-status` class from `statusHtml`; the caption dim transition (pinned mode) applies to the whole caption, tag included. The tags themselves do not animate or stage.

Copy not applied exactly: none. Typographic apostrophes are used throughout. Q2–Q6 answers are unchanged. The phone copy is unchanged, and the snapshot test checks it.

Status: claimed. Not committed, not pushed, full `npm test` not run.

## Answer

**Resolved 14 Oct 2026, commit 44fcec4.** Approved copy deck in landing-copy.ts. Addition 1 (status tags) moved to the money timeline by owner decision (06 item 4). Verified by the issue 10 gate. The owner chose to resolve the first wave (01–05) with the second, since the gate tests cover their criteria.
