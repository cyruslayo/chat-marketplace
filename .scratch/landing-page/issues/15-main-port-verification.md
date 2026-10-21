# 15 · Verify the ported landing page on main (wave gate for 11, 12 and 14)

Status: claimed
Type: task
Blocked by: 11, 12 (and 14 if it is in the wave)
Requested: 20 Oct 2026

## What to build

The gate for the port, in the same form as issue 10.

- **App-layer parity (ADR-0077).** `main` changed the guest kit (`verticalStartersHtml`, `taskRailHtml`, `taskStepHeaderHtml`, the `brand` option on the app bar) and `guest-content.ts`. With commerce off, the task rail and starters stay hidden (one vertical), so the landing's chat window and phone screens should still match the app. Prove it: compare the landing's app-layer markup with the real guest app's screens for the same example, and keep `test/fixtures/landing-phone-text.json` passing.
- **Captures** into `screenshots/15/`:
  - light and dark at 320, 390, 768, 1280 and 1440, plus 200% zoom;
  - the first viewport at 320×568, 360×640 and 390×800;
  - the pinned steps 2 and 4;
  - both the public render and the placeholders render.

  Findings must show no overflow, no control under 44px, no text under 12px, and the same left edge everywhere.
- **The Workers build.** Smoke-check `/welcome` against the Workers test environment from issue 12.
- **Full verification:** `npm run check`, then `npm test` once in the background, then `npm run test:workers`. Classify every failure as application or environment. Rerun only the affected files, in isolation, one browser run at a time.

## Acceptance criteria

1. The landing's app-layer screens match the guest app's current screens for the same example (commerce off)
2. Every capture's findings show no overflow, no control under 44px and no text under 12px, in light and dark
3. `/welcome` and its assets load in the Workers environment
4. `npm test` and `npm run test:workers` pass, with any pre-existing, unrelated failure named and evidenced

## Rules

- Keep 11, 12 and 14 claimed until this gate passes, then resolve them together (Definition of Done, items 8 and 9).
- Do not restore or commit screenshots that the full suite rewrites outside `.scratch/landing-page/`. List them for the owner.
- Ask the owner before merging to `main`.

## Comments

### Gate run — 21 Oct 2026 (branch `landing/11-port-onto-main`, commits through `d6fda26`)

**Build/check:** `npm run build` and `npm run check` clean (`build-15.txt`, `check-15.txt`). The build refreshed the tracked `dist/client.js` for issue 14's new copy export; committed as `e5a0b76`.

**Full suite (once, background):** `npm test`, 11:19 start, log `full-suite-15.txt`. Phase 1: 2040 tests, 1 failed; phase 2: 35 browser files, 33 passed, 2 failed. Classification, with isolated reruns one file at a time:

| Failure | Class | Evidence |
| --- | --- | --- |
| `production-install.test.ts` "A production install followed by the documented build and start commands starts the pilot" | **Application, caused by this wave (issue 12)** | `build-client.mjs` imported `tsx/esm/api`, a development dependency. Fixed in `d6fda26` by compiling the (import-free) `landing-assets.ts` in memory with `esbuild`, already a runtime dependency. No manifest or pin change; `apps/cloudflare/public` byte-identical before/after; test passes 4/4; check and the Workers asset spec pass. |
| `mobile-guest-journey-chromium.test.ts` AC23 "desktop viewport" | Load-sensitive flake, not application | Same file alone: 43/43 passed (`iso-mobile-15.txt`). Not touched by this wave. |
| `paystack-real-browser.test.ts` | Environment | Failure text: `checkout.paystack.com's DNS address could not be found` (`DNS_PROBE_STARTED`). Alone, 1/1 passed (`iso-paystack-15.txt`); DNS resolves now. |

**Not a clean green full run:** the full run predates the `d6fda26` fix, so no single full run is green for the final tree. Failures were cleared by the fix and isolated reruns, not by a second full suite. Prior gate exceptions (issues 27/30) do not apply to the landing, so DoD item 9 is not claimed; the owner decides between one more full run and an exception.

**Workers:** `npm run test:workers` 24 files / 162 tests passed (`workers-15.txt`), including `landing-assets.spec.ts`; `/welcome` and its assets in the Workers runtime were checked in a real browser under the unchanged CSP in issue 12.

**Captures** (`screenshots/15/`, 26 PNGs + `findings.txt`, script `.scratch/landing-page/capture-landing.ts`, restored from `44fcec4` with two harness-only fixes: `LocalGuestEnvironment.openNode`, and a fresh tab per still shot because a second tall screenshot in one headless tab stalls CDP): light and dark at 320, 390, 768, 1280, 1440; 200% zoom (640 CSS px) in both; placeholders render at 390 and 1440 in both; first viewports 320×568, 360×640, 390×800; pinned steps 2 and 4 in both themes. Findings across all 16 full-page renders: horizontal overflow none, controls under 44px 0, text under 12px 0, content-edge spread 0px (0.01px at 200%), rail labels intact. At 320×568 the composer is inside the first viewport and the reassurance line is not (563..603px), the same accepted state as issue 10. Visually inspected: 390×800 first viewport and pinned step 4 dark. The demo-mode captures remain in `screenshots/11/`.

**AC1 (app-layer parity):** `test/fixtures/landing-phone-text.json` and the landing phone-text tests passed in the full run (landing files in phase 1). No separate side-by-side diff against the live app screens was produced beyond that fixture test.

**Files the full suite rewrote outside `.scratch/landing-page/` (not restored, not committed; for the owner):** 34 tracked PNGs: `.scratch/guest-ui-consistency/screenshots/09/chat-payment-ready.png`; four in `.scratch/ui-phase3-discovery-detail/`; 29 in `.scratch/ui-recovery/recovered/`. Also line-ending churn in `apps/cloudflare/src/env.d.ts` and `apps/local-guest/dist/{gallery,offer,payment}.js`.

**State:** 11, 12 and 14 stay claimed; nothing resolved, merged, pushed or deployed.

### Second full suite — 21 Oct 2026 (tree `4cd18c2`, 12:19, log `full-suite-15b.txt`)

**Phase 2 (real browser, one file at a time): 35 files, 35 passed, 0 failed, 0 timed out.** The two earlier phase-2 failures (mobile-guest-journey AC23, paystack-real-browser) did not recur, which supports the load/network classification above.

**Phase 1: 2040 tests, 2039 passed, 1 failed:** `guest-identity-assurance.test.ts` "AC5 (review 4c): no source module imports through a non-literal import() or require() that the sweep cannot resolve". **Application, caused by this wave:** my `d6fda26` build fix loaded the allow-list with `import(\`data:...\`)`, which the sweep rightly forbids (it named `apps/local-guest/scripts/build-client.mjs`). Fixed in `fix(build): evaluate the landing allow-list bundle instead of importing it`: esbuild builds `landing-assets.ts` as an IIFE and `node:vm` `runInNewContext` reads the allow-list, so there is no `tsx` and no dynamic import. Evidence after the fix, isolated: `guest-identity-assurance.test.ts` + `production-install.test.ts` 59/59 pass; `npm run check` clean; `landing-assets.spec.ts` 3/3; `apps/cloudflare/public` byte-identical before and after the build.

**Status of DoD item 9:** across the two full runs every failure is explained and cleared: three in the first (one application, fixed; two environment/load, rerun green) and one in the second (application, fixed). There is still no single full run that is green on the final tree, because the last fix landed after the last run and was verified by the isolated reruns named above, as the gate allows. The owner may still ask for a third full run, or accept this evidence.

The suite again rewrote the issue 11 demo captures under `.scratch/landing-page/screenshots/11/`; those were restored, so the committed demo evidence is unchanged. The 34 rewritten PNGs outside `.scratch/landing-page/` are listed above and untouched. 11, 12, 14 and 15 remain claimed; nothing resolved, merged, pushed or deployed.

### Third full suite — 21 Oct 2026 (tree `68e271e`, started 15:56, log `full-suite-15c.txt`)

`npm test` on the final tree, run once in the background: **exit 0. Phase 1: 2040 tests, 2040 passed, 0 failed (the other node:test groups the runner prints, 227 tests, also 0 failed, 3 pre-existing skips). Phase 2 (real browser, one file at a time): 35 files, 35 passed, 0 failed, 0 timed out.** No failure to classify.

This is the single green full run on the final tree that the earlier entries lacked, so DoD item 9 is met for the landing wave: `npm run check` clean, this full run green, `npm run test:workers` 24 files / 162 tests green (run before the last build-script change; the affected `landing-assets.spec.ts` was rerun after it, 3/3), and the captures in `screenshots/15/` clean. The three-run history is: run 1, three failures (one application, fixed; two environment/load, green alone); run 2, one failure (application, fixed); run 3, none.

The 34 tracked PNGs outside `.scratch/landing-page/` that the suite rewrites are listed above and left uncommitted. 11, 12, 14 and 15 are still `claimed` pending the owner's go-ahead to resolve them together; nothing merged, pushed or deployed.
