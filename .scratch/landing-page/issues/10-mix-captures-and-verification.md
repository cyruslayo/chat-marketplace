# 10 · Captures, budgets and full verification for the new landing page

Status: resolved
Type: task
Blocked by: 09

## What to build

The verification gate for the wave of issues 07–10, in the same form as issue 03.

- Update `.scratch/landing-page/capture-landing.ts` and the audit script `capture-audit.ts`, then capture into `screenshots/10/`:
  - light and dark at 320, 390, 768, 1280 and 1440;
  - 1280 at 200% zoom;
  - the first viewport at 320×568, 360×640 and 390×800;
  - pinned desktop at steps 2 and 4.
- Findings to report:
  - horizontal overflow;
  - controls under 44px;
  - text under 12px;
  - longest prose line (75 characters or fewer);
  - hero H1, composer and reassurance inside the first viewport at 360×640 and 390×800, and the composer inside it at 320×568;
  - the left content edge of the app bar, sections and footer (must match);
  - text contrast on the hero and closing scrims, measured over the lightest region of each photo.
- Budgets, measured on a throttled "Fast 3G"-class profile in the Chromium harness:
  - fonts 160 KB or less;
  - hero image 120 KB or less at 1440 and 50 KB or less at 390;
  - H1 and composer painted before the hero image finishes;
  - no request to any host other than the page's own.
- Read each PNG and note anything off. Compare against the `Mix-Desktop` and `Mix-Phone` boards and list visible deviations.

## Acceptance criteria

1. Every capture's findings show no overflow, no control under 44px and no text under 12px
2. The first-viewport requirements hold at each listed size
3. Hero and closing text meet WCAG AA contrast over their photos in light and dark
4. Font and hero image payloads stay within budget, and no third-party request is made
5. The full `npm test` suite passes after all wave changes

## Rules

- Run the full browser suite in the background with a long timeout (about 12 minutes). Never run two browser suites or capture sweeps at once.
- Keep 07–09 claimed until this gate passes; then resolve 07–10 together (Definition of Done, items 8 and 9).
- Delete walkthrough logs afterwards.

## Comments

**14 Oct 2026, orchestrator, carried over from 08 and 07:**
- App layer at 390: in the beat 5 price breakdown, "Refundable Security Deposit (separate): ₦20,000" wraps so the amount breaks awkwardly. This is kit layout outside 08's scope; check it in the captures and raise it against the guest kit if it remains.
- Issue 04 AC9 failed once in an early 07 run, with no message, and then passed. Watch it in the full run.
- "Failed to connect to Chrome DevTools" launch errors appear when other Chrome processes are running. Rerun only the affected tests and record them.
- From 09: the How section (and at least the eyebrow areas) paint the foundations canvas (#F6F5F0), not `--landing-ground` (#F4EFE6). Brand-layer sections should sit on landing tokens. Check every section's computed background, and fix or justify each one.
- From 08: the hero and closing photos are gated off on the public page until issue 06 item 5 is approved. Measure the hero image budget on the `placeholders: true` render, and then again once approved photos exist.
- **14 Oct 2026, orchestrator:** Claimed. One agent; the orchestrator reviews. Order: carry-over fixes → captures and budgets → the full `npm test` last, run once in the background.

**Results note (verification agent, 14 Oct 2026). Status stays `claimed`; nothing committed.**

- Step 1a (backgrounds): `apps/web/src/shortlet-landing.css` body `--color-canvas` -> `--landing-ground`; new unlayered `html { background: var(--landing-ground) }` (foundations html is layered). Before (light): body and How/Questions showed #F6F5F0; after: #F4EFE6. Dark unchanged (#111814). Section backgrounds now: hero, money, closing, footer forest tokens; trust paper token; app bar transparent on photo / ground when solid. Issue 07 AC4 and 09 AC3 re-verified (pass).
- Step 1b (390 deposit): the beat 5 price breakdown value `.ui-price-breakdown__value` has no `nowrap` on the landing phone. At 390 the deposit amount breaks inside the number ("₦20,00" / "0") and at 320 ("₦20," / "000"). The "Total to complete booking" value at 390 breaks the same way ("₦390,0" / "00"). Reported, not fixed (kit CSS).
- Captures: `screenshots/10/` (findings.txt). Overflow none, controls under 44px 0, text under 12px 0, longest prose line 74, content edges equal (spread 0px; 0.01px at 200%). First viewport: composer inside at 320x568, 360x640, 390x800; H1 and reassurance inside at 360x640 and 390x800; reassurance at 320x568 sits at 563..603 px (outside, not required).
- AC3 (`Issue 10 AC3...`): pass. 80 measurements (10 text elements x 2 widths x 2 themes x placeholders/default). Lowest: hero eyebrow 4.56:1 (needs 4.5); hero eyebrow 390 4.57:1; hero H1 accent 390 4.58:1 (needs 3:1).
- AC4 (`Issue 10 AC4...`): FAIL, three assertions. Fonts 71.6 KB (budget 160 KB) pass; hero image 71.6 KB at 1440 (budget 120 KB) pass; 71.6 KB at 390 (budget 50 KB) FAIL; first contentful paint 2988 ms vs hero image finished 2005 ms at 1440 FAIL; 2456 vs 1793 ms at 390 FAIL. No third-party requests. Default render: no hero/closing photo elements (pass).
- Full `npm test` (run 585b6dfd): 1587 passed, 2 failed, 1 skipped. Failures: `Issue 10 AC4` (above) and `test/cloudflare-harness.test.ts` AC3 (regex on `scripts/run-tests.mjs` source; neither file changed in this wave; pre-existing). Issue 04 AC9 passed in both landing files. No "Failed to connect to Chrome DevTools" errors.

### Owner-deferred and final gate (verification agent, 14 Oct 2026). Status stays `claimed`; nothing committed.

**Owner exception to Definition of Done item 9 (14 Oct 2026): no second full run.** Evidence: full run 1ba3c8e4-59e8-42c5-adaf-6d5632ea5740 on the final code, plus isolated reruns through the repo runner (run records kept).

- Full run 1ba3c8e4 (ended 15:01): 1585 passed, 4 failed, 2 skipped. Failures:
  1. `test/cloudflare-harness.test.ts` AC3 (regex on `scripts/run-tests.mjs`): pre-existing; not touched by this wave; tracked separately.
  2. `test/landing-page-chromium.test.ts` "Issue 10 AC3 …": failed in the full run and reproduced in two isolated runs before the harness fix (below).
  3. `test/listing-gallery-chromium.test.ts` AC3 (full-screen photo viewer): passes in isolation (run a6083230-5ffd-4f28-ab20-72c0ec5bbfd6, 5/5). Classified as contention from the overlapping run.
  4. `test/paystack-real-browser.test.ts` "Paystack callback and handoff routes restore authoritative state in real Chromium": passes in isolation (run e1b0827e-f3d5-4ed4-abc7-95cd6eab5991, 1/1). Classified as contention (70 s duration in the full run).
- Issue 10 AC3, classification: not pure contention. The screenshot showed the hero text in the "backdrop" pixels, because the hero text children set their own `visibility: visible` and the container-only hide did not reach them. This reproduced in isolated runs before the fix. Fixed in the harness, not in the page: the test now injects a `!important` visibility mask on the container and its descendants, fails closed if any text is still visible, and waits two frames before capture. Run after the fix: landing Chromium file 977c210a-e7b9-473e-b02c-fbdf8e0fd1e8: 42 passed, 0 failed, 1 skipped (AC4 owner-deferred). The 80 AC3 measurements are unchanged (tightest 4.56:1 hero eyebrow). The full run 1ba3c8e4 predates this harness fix; its AC3 result is therefore not evidence for the final test code, and the isolated run is.
- Final-code checks: `npm run build` exit 0; `npm run check` exit 0; non-browser landing + motion 40/40 pass.
- Deposit wrap (CSS, `.landing-phone .ui-price-breakdown__value` nowrap + flex-shrink 0): crops `screenshots/10/` regenerated; at 320 and 390 the amount is whole ("₦20,000"), the label wraps ("Refundable Security / Deposit (separate):"); the due row reads "₦390,000" on one line at 390.
- AC4 split: `Issue 10 AC4` (fonts ≤ 160 KB, every request same-origin, default render with no hero or closing photo element) passes. `Issue 10 AC4 (owner-deferred)` is skipped with the owner's reason; its assertions are unchanged. Measured numbers, recorded for later: hero image 71.6 KB at both widths (budgets 120 KB at 1440, 50 KB at 390); first contentful paint 2988 ms vs hero image finished 2005 ms at 1440; 2456 ms vs 1793 ms at 390; app-layer example photos on the default page about 290 KB.
- Not run: the complete suite a second time (owner decision). Evidence for the wave is the full run 1ba3c8e4 plus the isolated runs above.
- Screenshots the full suite rewrote under `.scratch/ui-recovery/` (57 files) are left as they are for the owner's decision.

## Answer

**Resolved 14 Oct 2026, commit 44fcec4.** Gate: captures in screenshots/10; AC3 contrast and AC4 font/origin tests. Full run 1ba3c8e4 plus isolated reruns, with the owner exception to DoD item 9; photo budgets owner-deferred. Verified by the issue 10 gate. The owner chose to resolve the first wave (01–05) with the second, since the gate tests cover their criteria.
