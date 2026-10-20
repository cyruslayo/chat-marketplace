# 03 · Captures, reflow and target checks, full verification

Status: resolved
Type: task
Blocked by: 02

## What to build

Evidence that the landing page meets ADR-0078 at every width, then the full suite.

- Capture `/welcome` at 320, 390, 768 and 1280 wide, light and dark, into
  `.scratch/landing-page/screenshots/03/`, using `.scratch/guest-ui-consistency/capture.ts` (or a copy
  next to it). Capture with reduced motion so every screen is in its final state, and add one
  1280-wide capture with motion allowed, scrolled to beat 3, showing the pinned phone.
- Write `findings.txt` there listing, per width: horizontal overflow (none allowed) and every visible
  control under 44 × 44 CSS px (none allowed; hidden native inputs excepted).
- Fix any finding in the landing files only.
- Run `npm run check`, then the full `npm test` in the background (the browser phase takes about
  12 minutes; never run two browser suites at once). Report failures with diagnosis; do not
  blindly re-run.

## Acceptance criteria

1. Landing captures exist for 320, 390, 768 and 1280 in light and dark, plus the pinned desktop view
2. No landing width has horizontal overflow or a control under 44 pixels
3. The type check and the full test suite pass

## Rules

Do not commit. Delete any walkthrough log you create.

## Comments

**Captures (issue 03 run, reduced motion unless noted; `.scratch/landing-page/capture-landing.ts`)**
- `screenshots/03/landing-{light,dark}-{320,390,768,1280}.png`: full page, final states. Page heights 7826 / 6847 / 6058 / 4537 px after the rail fix.
- `screenshots/03/landing-pinned-1280.png`: motion allowed, beat 3 caption in the middle band, phone pinned (`caption 3`, active).
- `screenshots/03/landing-beat4-reviewing-390.png`: motion allowed, 390 wide, captured while "The Operator is reviewing" is shown (beat 4 stage 3).
- Dark mode is set with `data-theme="dark"`, not by emulating `prefers-color-scheme`, because the Chromium helper does not expose colour-scheme emulation. The foundations token blocks cover both attributes.

**Findings, before fixes** (`screenshots/03/findings-before.txt`): at all four widths, both themes, there is no horizontal overflow and no element past the viewport edge. One control is under 44 px at each width: the skip link `a.landing-skip` (171 x 40, 40 px tall). It sits at y=-72 while hidden, so it is only focusable and visible on focus. Fix: `min-block-size: 44px`, `min-inline-size: 44px` and inline-flex centring on `.landing-skip`.

**Rail fix (visual review)**: the foundation's `.ui-rail > li { overflow-wrap: anywhere }` split "Confirmed" into "Confirme / d" in the 390 and pinned phones. The fix is scoped to `.landing-phone .ui-rail` in `apps/web/src/shortlet-landing.css`: column gap 0, inline padding one space-1 step, `overflow-wrap: normal; word-break: normal; hyphens: none`, label size 0.625rem with letter-spacing -0.01em. Labels and foundations are unchanged. The capture now also reports rail labels that break mid-word or overflow. Probe without the fix (`screenshots/03/findings-rail-probe-without-fix.txt`): "Confirmed" is flagged at 390 and at 1280 (6 flags in total, none at 320, where the rail has three columns).

**Findings, after fixes** (`screenshots/03/findings.txt`, all eight width and theme combinations): horizontal overflow none, elements past the edge 0, journey rail breaks 0, controls under 44x44 0. Visible controls checked: 12 per width (hidden native radio/checkbox inputs excluded: 0).

**Visual check**: the 390 reviewing capture shows the typing-dots marker to the left of "The Operator is reviewing", centred on the line; nothing overlaps or is clipped in the viewed area; the pinned 1280 phone shows the stay summary beside caption 3; the 390 full-page light capture shows the photos rendering. Dark-mode text legibility was checked only at thumbnail scale, not at full resolution.

**Verification**
- `npx tsx --test` on test/landing-page.test.ts (9/9), test/landing-page-motion.test.ts (7/7) and test/landing-page-chromium.test.ts (12/12, rerun after the rail fix).
- `npm run check`: passes (exit 0, run before the CSS-only rail change; no TypeScript changed since).
- `npm test` (run `c0af0ee7-6a3a-4726-b064-b14fda4a1ac1`): 1532 passed, 3 failed, 1 skipped.
  - test/cloudflare-harness.test.ts, AC3: pre-existing, not landing. Error: "The input did not match the regular expression /readdirSync\(join\(root, "test"\)\)/". `scripts/run-tests.mjs` (line 79) now uses `readdirSync(testRoot)`, a change from committed b48cfbf / 221904f; the file is unchanged in the working tree. The same assertion fails on a clean worktree of HEAD (6f162fd). Not fixed here.
  - test/listing-gallery-chromium.test.ts, AC3 (full-screen viewer): flaky. Passes alone on this branch (5/5) and on the HEAD worktree (5/5). It failed at 5768 ms in the full run; the run record omits the error text. The file does not reference the landing page.
  - test/paystack-real-browser.test.ts (callback and handoff routes): flaky. Passes alone on this branch (1/1) and on HEAD (1/1). It failed at 13669 ms in the full run; the run record omits the error text. The file does not reference the landing page.
- Temporary HEAD worktree (`C:/AI2026/cm-base`) and its node_modules junction were removed; the main tree's node_modules is intact.

No fixes were needed to the landing test files. Nothing was committed. Status left claimed.

## Answer

**Resolved 14 Oct 2026, commit 44fcec4.** Capture and audit harness capture-landing.ts; findings in screenshots/03. Verified by the issue 10 gate. The owner chose to resolve the first wave (01–05) with the second, since the gate tests cover their criteria.
