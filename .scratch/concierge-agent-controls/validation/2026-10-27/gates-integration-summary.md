# Pre-deploy gates: integration/concierge-controls (2026-10-27)

Branch: integration/concierge-controls
HEAD at start: 28eea3e0c5ac400626e2bc211fddefdf220df249
Fix commit: d3e1b9b "fix(test): use main's browser harness in the integration branch" (restores scripts/browser-phase.mjs, scripts/browser-phase.d.mts, test/browser-phase-timeout.test.ts to main's versions; diff vs main now empty; committed with explicit paths)
Working tree: pre-existing uncommitted changes present and not touched (for example apps/cloudflare/public/_headers, apps/local-guest/dist/*.js). No push, deploy, cf/wrangler or paid calls. Every command ran with `env -u LLM_API_KEY`.

## Stage results

| # | Command | Exit | Result |
|---|---|---|---|
| 1 | `npm run check` (before the fix) | 0 | clean |
| 2 | `npm run test:workers` (earlier, before the fix; not rerun) | 0 | 28 of 28 files, 181 of 181 tests |
| 3a | `npm run check` after restoring harness files | 0 | clean |
| 3b | Solo `npx tsx --test` of five harness files (5-minute timeout each) | 0 each | see table below |
| 4 | `NODE_ENV=test COMMERCE_REFERENCE_TEST_KEY=allow npm test` (after commit d3e1b9b) | 1 | completed; see below |
| 5 | Solo reruns of the four failing files | see below | |

Solo harness results (after restore, commit d3e1b9b):

| File | Tests | Pass | Fail | Exit |
|---|---|---|---|---|
| test/browser-attach.test.ts | 11 | 11 | 0 | 0 |
| test/browser-lock.test.ts | 12 | 12 | 0 | 0 |
| test/browser-phase-timeout.test.ts | 5 | 5 | 0 | 0 |
| test/browser-phase-aggregate.test.ts | 5 | 5 | 0 | 0 |
| test/chrome-devtools-config.test.ts | 5 | 5 | 0 | 0 |

## Full npm test (run 11), exit 1

- Phase 1 (concurrent, 315 files): 2,458 tests, 2,456 pass, 2 fail, 0 cancelled, 0 skipped. Duration about 900 s. Log lines 6 to 15236.
- Phase 2 (real browser, one file at a time, 900 s per file cap): 35 files, 33 passed, 2 failed, 0 timed out.
- Phase 1 failures (log lines 999 and 1043):
  - `back-office-manual-transfers.test.ts`: "AC2 — Confirming requires the bank transaction reference..." (`fetch failed`)
  - `back-office-owner-overpayment.test.ts`: "AC2 — The owner's totals show the over-paid amount separately..." (`fetch failed`)
- Phase 2 failures:
  - `test/commerce-store-pages.real-browser.test.ts`: "AC3: Captures at the four widths pass the overflow and 44px checks". Error: `Timeout waiting for text: Visible Store Offer ... body: Not Found`
  - `test/commerce-surfaces-chromium.test.ts`: two tests, "real Chromium renders visible discovery, cart and order facts from registered commerce catalogues" and "real Chromium renders the proposed checkout and the post-confirm payment-unavailable result without a blank surface". Error: `Timeout waiting for text: Visible Northstar Tote ...` and `Timeout waiting for text: Checkout · Harbour Goods ...`

Stop note: the full run is complete. Earlier, the hung run 03 was killed by me; that log and its `.exit` are not valid results.

## Solo reruns of the four failing files (one at a time)

| File | Solo result | Classification |
|---|---|---|
| back-office-manual-transfers.test.ts | 5 of 5 pass, exit 0 | pass-on-rerun (flake under full-suite load). Not on the known-flake list. |
| back-office-owner-overpayment.test.ts | 5 of 5 pass, exit 0 | pass-on-rerun (flake under full-suite load). Not on the known-flake list. |
| commerce-store-pages.real-browser.test.ts | 0 of 1 pass, exit 1 | REAL, still failing solo. Concierge/commerce surface. NEW. |
| commerce-surfaces-chromium.test.ts | 0 of 2 pass, exit 1 | REAL, still failing solo. Commerce surface. NEW. |

The two `fetch failed` back-office tests were not on the known-flake list and do not touch the listed areas. They pass solo, so I classify them as load flakes.

The two real-Chromium commerce files are NEW failures. They are not on the known-flake list and touch commerce rendering (store pages, checkout). They must be fixed or explained before this gate is green. Possible cause not checked: the store page returns `Not Found` for `Visible Store Offer` and the Chromium surface never renders the expected catalogue text. Those files were not inspected further.

## Known flake list status

Known flakes not observed in this run: daily-export D3, pilot-agent-smoke-reference, paystack-real-browser, data-migration, landing-assets, pilot-local AC4, guest-cross-tab-concurrency.

## Earlier notes (kept for the record)

- The original hang (run 03, Phase 1) was `test/browser-attach.test.ts`. Root cause: the fail-closed `killProcessTree` in `scripts/browser-phase.mjs` on Windows, called without identity from `test/helpers/chrome-devtools.ts:229` and `test/browser-attach.test.ts:158,170`. Fixed by restoring main's harness in commit d3e1b9b. browser-attach now passes solo and exits in about 1.5 s.
- Orphan PID 44472 (`node -e setInterval ... --browser-test-token=...`, started 11:08:51, parent already dead). Not verified as mine and not killed. Owner can stop it.
- Controls worktree (`C:\AI2026\chat-marketplace-controls`, branch codex/concierge-agent-controls) also hung on browser-attach solo before the fix; not changed.

## Gate status

- `npm run check`: GREEN (exit 0 before and after the fix)
- `npm run test:workers`: GREEN (exit 0, earlier run, unaffected by harness restore)
- Solo harness files: GREEN (5 of 5 files, all exit 0)
- `npm test`: NOT GREEN. Exit 1. Two NEW real failures in `commerce-store-pages.real-browser.test.ts` and `commerce-surfaces-chromium.test.ts` (commerce surfaces, outside the known-flake list). Two back-office files failed under load and pass solo.

## Recommendation

1. Investigate the two real-Chromium commerce failures before merge. Check whether the commerce switch or store routes are off or changed on this branch.
2. Re-run `npm test` once after that fix. The back-office `fetch failed` flakes need a note in the summary, not a fix.
3. Owner to stop orphan PID 44472.

## Final status (27 Oct 2026, integration run and owner decision)

Recorded after the rows above. Earlier sections are unchanged. The owner's facts for this final status:

- Integration HEAD `d3e1b9b`: merge `ae708b1` of `codex/concierge-agent-controls` at `f3e3549` into `main` at `0ddbb2c`, fix `28eea3e`, harness restore `d3e1b9b`.
- `npm run check`: exit 0.
- `npm run test:workers`: 28 of 28 files, 181 of 181 tests. This row is the run recorded above, taken before the harness restore; it was not rerun after it.
- Solo harness files, exit 0 each: `browser-attach` 11/11, `browser-lock` 12/12, `browser-phase-timeout` 5/5, `browser-phase-aggregate` 5/5, `chrome-devtools-config` 5/5.
- `NODE_ENV=test COMMERCE_REFERENCE_TEST_KEY=allow npm test`: exit 1. Phase 1: 2,458 tests, 2,456 pass, 2 fail. Phase 2: 35 files, 33 pass, 2 fail.
- Back-office `fetch failed` failures (`back-office-manual-transfers`, `back-office-owner-overpayment`) are load flakes. Both pass 5/5 solo, exit 0.
- Commerce real-browser failures (`commerce-store-pages.real-browser.test.ts`, `commerce-surfaces-chromium.test.ts`, 2 tests) reproduce solo (0 of 1 and 0 of 2, exit 1). Not fixed and not diagnosed.
- Owner decision, 27 Oct 2026: treat the two commerce real-browser failures as commerce-only. Commerce is not shipping: `COMMERCE_ENABLED` stays off (ADR 0104). Probable but unconfirmed cause: those tests start guest-server without the injected commerce module after the ADR 0104 decision 6 change, and they have not run in the browser phase since. This supersedes Recommendation 1 above as a merge blocker for the commerce scope only; the failures are still open.
- Local staging build of this branch (`cf-vite`, `SHORTLET_DEMO=enabled`, `CONCIERGE_MODE=openai-compatible`, `LLM_MODEL=openai/gpt-6-luna` via OpenRouter, `COMMERCE_ENABLED` unset): exit 0. Descriptor `COMMERCE_ENABLED` is `"false"`; commerce HMAC key names are absent; worker `shortlet-pilot-staging`; 3 Durable Object classes; 2 R2 buckets. Not deployed.
- No live evidence yet for the grader fix `f3e3549` (`priceUnitSource`).

Gate status: `npm run check`, `npm run test:workers` and the five solo harness files are green. `npm test` is not green (exit 1), with the two commerce real-browser failures open and treated as commerce-only, and two load-flake back-office files that pass solo. No push, deploy, Cloudflare/wrangler command, test run or paid call was part of this record. No secret values are recorded here.
