# Move to `@cylayo/weaver-*` 0.2.1 from npm

Status: resolved
Type: task
Blocked by: none
Requested: 6 Oct 2026

## Why

The app vendors `@weaver/core` and `@weaver/web` 0.1.2 as tarballs (`vendor/weaver/`, pinned in `package.json` as `file:vendor/weaver/weaver-*-0.1.2.tgz`). They were vendored because Weaver was not published. It now is, as `@cylayo/weaver-core` and `@cylayo/weaver-web` 0.2.1.

The 0.2.x line adds the producer, stream ingestion and safety budgets that later issues use. The user chose npm with exact pins over re-vendoring (PRD, Decisions).

## What to build

- **Dependencies.** In `package.json`, replace the two `file:` deps with `"@cylayo/weaver-core": "0.2.1"` and `"@cylayo/weaver-web": "0.2.1"`. Use exact versions, with no `^`. Run `npm install` so `package-lock.json` is updated in the same change.
- **Vendoring.** Delete:
  - `vendor/weaver/` (README and both tarballs)
  - `scripts/verify-weaver-vendor.mjs`
  - the `verify:weaver` npm script

  Then grep for `verify-weaver`, `verify:weaver` and `vendor/weaver` and remove or update every reference in docs, tests and scripts.
- **Imports.** Rename every `@weaver/core` import to `@cylayo/weaver-core`, and every `@weaver/web` import to `@cylayo/weaver-web`. This touches roughly 87 files in `apps/`, `scripts/` and `test/`, including dynamic `import("@weaver/web")` in `scripts/pilot-agent-smoke.ts`. No exported symbol was renamed. If `packages/platform-core/CONTEXT.md` (Web Agent Adapter) names the package, update it.
- **Widened error unions.**
  - `ComponentTreeError` and `ComponentInstanceError` now include `ResolutionBudgetExceededError`, with code `RESOLUTION_BUDGET_EXCEEDED`.
  - `WeaverRuntimeConfigurationError` gains `SAFETY_CONFIGURATION_FAILED`.

  Find every switch or narrowing over these codes, including the `WeaverSurfaceResolutionError` consumers, and handle the new cases. A budget overrun must fail closed to the existing fallback path (ADR 0074).
- **Safety budgets.** Keep Weaver's defaults: resolution depth 32 and 1,000 resolved instances. Prove they are enough for the largest real surfaces.
- **Rebuild.** Run `npm run build` and commit the rebuilt `apps/local-guest/dist/*.js`. The bundle comments will then show `node_modules/@cylayo/...`.

## Acceptance criteria

- **AC1:** `package.json` pins `@cylayo/weaver-core` and `@cylayo/weaver-web` at exactly `0.2.1`, and `package-lock.json` resolves both from the npm registry with an `integrity` hash. A test reads both files.
- **AC2:** No source, test or script file imports `@weaver/core` or `@weaver/web`, and `vendor/weaver/` and `scripts/verify-weaver-vendor.mjs` do not exist. Extend `test/weaver-dependency-boundary.test.ts` to check this.
- **AC3:** `domains/shortlet/src` and `packages/platform-core/src` import no `@cylayo/weaver-*` package. This is the existing boundary assertion, retargeted.
- **AC4:** The largest discovery fixture (the maximum result count the builder emits) and the largest compare fixture each resolve on a default-budget runtime without `RESOLUTION_BUDGET_EXCEEDED`.
- **AC5:** A surface that exceeds the resolution budget surfaces as a rendering failure and fails closed to the textual fallback; it never renders partially. The test uses a small configured budget.
- **AC6:** Every existing render, parity and Chromium suite passes with **unchanged expectations**. This is the replay and semantic-parity gate for the runtime upgrade (ADR 0079).

## Verification

`npm run check`; `npm run build`; `npm test` in the background (the browser phase takes about 12 minutes); then a clean `npm ci` followed by `npm run check`.

## ADR compliance

| ADR | Constraint | Where |
| --- | --- | --- |
| 0081 | Weaver stays an adapter dependency, with no Weaver types in authoritative packages. Upgrades need replay and parity plus verified rollback. | AC2, AC3, AC6; rollback is a revert of this one commit |
| 0079 / 0069 | Runtime upgrades need replay, semantic-command parity, safe rejection and rollback. | AC5, AC6 |
| 0074 | A failure fails closed to text plus a conventional route. | AC5 |

## Comments

- 17 Oct 2026: Not resolved by the Weaver03 integration. This issue has no implementation answer or Definition of Done evidence recorded here. Before resolution, document evidence separately for AC1–AC6 (exact npm pins and lockfile hashes; removal/import boundary; authoritative-package boundary; both largest fixtures within default budgets; configured-budget fail-closed behavior; unchanged render/parity/Chromium expectations), and for the verification gate (`npm run check`, build, full `npm test`, clean `npm ci` followed by check), including the landing commit/revertability. The integrated Weaver03 full-suite pass is useful combined evidence for AC6 but does not establish the other criteria or the clean-install gate.

## Answer

Implementation landed in `65038492356df86918f534d6e23f88302503a98a` (`Migrate guest UI to Weaver 0.2.1`), integrated with the platform portability repair `e26e253`, and is present in the integrated source at `b0c1454` / `a1014e7`. The follow-on safe-fallback integration is committed in `38e4829`; the scroll-readiness regression is in `7276cc3`. The migration remains revertable as its original single commit, with portability, runtime and follow-on changes separately committed.

### Acceptance evidence

| Criterion | Evidence and outcome |
| --- | --- |
| AC1 — exact npm pins and registry integrity | `test/weaver-dependency-boundary.test.ts`: `AC1 — package.json pins both Weaver 0.2.1 dependencies and the lockfile resolves registry integrity`. It reads both manifest and lockfile, asserts exact `0.2.1`, npm registry URLs and SHA-512 integrity values. The committed lockfile contains core integrity `sha512-EpRGerDrflX2akUVZ+8R2SrTsMfXWrVL2JjZ3kMbN3CEQTQTNfuIuiG22d1ruYS99XM7i4IqYa6gNc/yP4Vztw==` and web integrity `sha512-DuYq4yqkA/MjHndIAe2RX6GzFPy0GjNbWCWxp/KzMaMfXOqLXTxRB9TxiNYqpe7yhVYv6Z6XUyskIm4yAAyD9Q==`. Passed in the focused run recorded below. |
| AC2 — no legacy imports/vendor/verifier | `test/weaver-dependency-boundary.test.ts`: `AC2 — source, tests and scripts use no legacy Weaver imports or vendor verifier`. Scans `apps`, `scripts`, and `test`, and verifies `vendor/weaver` plus `scripts/verify-weaver-vendor.mjs` do not exist. The npm `verify:weaver` script was removed in `package.json`; the only executable-code hits are the test's own negative assertions. A repository-wide search of `README.md`, `docs`, `scripts`, `package.json`, `.github`, `apps`, `test`, `packages`, and `domains` found no obsolete reference except those intentional test strings. Current migration guidance now labels old package/vendor details as completed historical context (`.scratch/weaver-catalogues/PRD.md`) and issue 08 explicitly preserves dated issue evidence while keeping current setup guidance free of retired instructions. Historical validation claims containing the deleted verifier remain at `.scratch/shortlet-concierge-launch/issues/12-capability-gate-ussd-and-authentication.md`, `.scratch/shortlet-concierge-launch/issues/13-present-contract-and-release-arrival-data.md`, `.scratch/shortlet-concierge-launch/issues/19-amend-material-booking-terms.md`, `.scratch/shortlet-concierge-launch/issues/20-enforce-standardized-guest-conduct.md`, `.scratch/shortlet-concierge-launch/issues/21-cancel-and-determine-no-show.md`, `.scratch/shortlet-concierge-launch/issues/24-account-for-a-protection-fund-remedy.md`, `.scratch/shortlet-concierge-launch/issues/25-quote-and-collect-a-security-deposit.md`, `.scratch/shortlet-concierge-launch/issues/27-appeal-and-finalize-a-deposit-claim.md`, and `.scratch/shortlet-concierge-launch/issues/28-post-commission-and-revenue-release.md`. These are dated reports of tests run at those earlier commits, not current runnable instructions, so their historical evidence was preserved rather than rewritten. The issue 01 description and deleted-item names remain as the migration's acceptance/history evidence. |
| AC3 — authoritative domain/application boundary | `test/weaver-dependency-boundary.test.ts`: `AC3 — authoritative application and domain files do not import Weaver`. It recursively scans `domains/shortlet/src` and `packages/platform-core/src` for either legacy or published Weaver package imports. Passed in the focused run. |
| AC4 — largest discovery and compare fixtures fit defaults | `test/weaver-web-host.test.ts`: `AC4 — Largest local discovery and two-stay comparison fixtures resolve on the default runtime budget`. It builds the local maximum Lagos result fixture, processes/mounts discovery and a two-result compare on `createWeaverWebHost()` defaults, and asserts both mounts succeed. The dependency boundary test also asserts the published defaults are depth 32 / 1,000 instances. Passed in the focused run. |
| AC5 — configured budget overrun fails closed without partial rendering and preserves text/route fallback | `test/weaver-web-host.test.ts`: `AC5 — Resolution budget failure rejects the whole surface instead of mounting a partial render` proves the actual `RESOLUTION_BUDGET_EXCEEDED` tree-resolution error and no partial mount; `AC5 — A real resolution budget error displays the guest text fallback and conventional route` sends the actual `host.mount()` result through `mountGuestSurfaceOrFallback`, the shared production entry point used by `client.ts`, checks the nested Weaver budget error, then asserts guest text, exact conventional route and label, fallback renderer marker, and absence of partial rich content. Both pass in the focused run. |
| AC6 — existing render/parity/Chromium suites with unchanged expectations | Historical integrated Weaver-03 evidence (see issue 03) was phase 1 `1809 passed, 0 failed`; phase 2 `177 passed, 0 failed, 2 skipped`. Final candidate gate: `NODE_ENV=test npm test`, phase 1 `1817 passed, 0 failed`; phase 2 `177 passed, 0 failed, 2 skipped`. This run includes the shared safe-fallback helper, its real mount-budget regression, and the scroll-readiness test change; the preexisting rendering/parity assertions remain unchanged. The 320px scroll trace showed the assistant append while a requestAnimationFrame was pending (`scrollTop=0`, `scrollHeight/clientHeight=254/154`, turn at 313–427px below container 189–343px), then the scheduled frame scrolled to 100 and brought it into view. The browser test now polls for that same complete-visibility condition before asserting; no product scroll behavior or assertion was weakened. The isolated scroll/fallback browser tests also passed 2/2. |

### Verification evidence

- `npm ci` in the isolated candidate worktree after merging current main at `23504dc`: passed (162 packages added; npm reported 7 high-severity audit findings). The subsequent candidate patch changed no dependency manifests or lockfile.
- `npm run check`: passed after the clean install and again with the final scroll-test change, including all configured TypeScript projects and the Worker bundle guard.
- `npm run build`: passed after the client fallback integration; `apps/local-guest/dist/client.js` was regenerated and committed with `38e4829`. Incidental generated artifacts were restored against the clean pre-test baseline.
- `npx tsx --test test/weaver-dependency-boundary.test.ts test/weaver-web-host.test.ts`: 15 passed, 0 failed, 0 skipped, including the real resolution-budget-to-text-and-route regression.
- Post-merge Worker suite (`npm run test:workers`): 100 passed, 0 failed across 20 files.
- Scroll-readiness and real-Chromium fallback regressions: 2 passed, 0 failed. The former records 320px mutation/frame timing and waits for the unchanged visibility requirements at both 320px and 1280px.
- Final full gate: `NODE_ENV=test npm test`, phase 1 `1817 passed, 0 failed`; phase 2 `177 passed, 0 failed, 2 skipped`; exit code 0. Durable output: `C:\Users\Cyrus\AppData\Local\Temp\opencode\weaver01-final-npm-test-after-scroll-readiness.log`.

### ADR and Definition-of-Done self-review

| ADR | Constraint applied | Criteria/code path |
| --- | --- | --- |
| ADR 0081 | Weaver remains an adapter dependency and is excluded from authoritative domain/platform-core packages; integration must retain parity and be independently revertable. | AC2, AC3 and AC6; `test/weaver-dependency-boundary.test.ts`; migration is isolated in commit `6503849`. |
| ADR 0079 and ADR 0069 | Runtime change requires replay/semantic parity, safe rejection and rollback evidence. | AC5/AC6; `test/weaver-web-host.test.ts` rejection test and recorded integrated full-suite result. |
| ADR 0074 | Rendering failures fail closed to safe text plus a conventional route. | AC5; shared production fallback entry point `apps/local-guest/src/guest-surface-fallback.ts`, called for failed Weaver mounts from `apps/local-guest/src/client.ts` and exercised against the actual resolution-budget error in `test/weaver-web-host.test.ts`. |
| ADR 0078 | The guest experience retains 320px reflow/accessibility expectations and respects reduced-motion behavior. | AC6; the scroll regression still asserts the latest turn is fully visible within the 320px and 1280px transcript; no product motion or reduced-motion behavior changed. |
| ADR 0075 | Minimize interaction data and keep restricted credentials/identity material out of logs/audit. | No auth, identity, audit or logging behavior was changed by dependency migration; this change adds no logging path. |

Definition-of-Done checklist: (1) AC1–AC5 have dedicated AC-named tests; AC6 passed on the final candidate with phase 1 `1817/1817` and phase 2 `177/177` plus 2 documented skips; (2) AC5 exercises the actual configured-budget error and verifies visible text, conventional route and absence of partial render; (3) the intersecting ADRs above were read and mapped; (4) no new constructor dependency was added by the dependency migration; the helper consumes the mount result, guest presentation, DOM mount and route telemetry callback; (5) no new product policy value was introduced—the safety limits are Weaver defaults tested as 32/1,000; (6) no credential/audit/log path changed; (7) clean-install/check/build/focused/Worker/full-suite validation passed as recorded above. Current runnable documentation has no retired package/verifier guidance; dated validation records remain qualified history, not rewritten. The isolated scroll trace showed the test had sampled before the scheduled layout-dependent correction; the test now waits for the same strict visibility assertion without sleeps, skips, or weaker conditions. **Status: `resolved` after independent code/docs review and full-suite validation.**

- 18 Oct 2026: Final gate completed on candidate source `38e4829` plus approved test patch `7276cc3`; issue 01 resolved. A later redundant retry during diagnostic-only frame-counter editing encountered disk exhaustion; the diagnostic edit was reverted to the exact previously full-suite-validated test content. No source/product code changed as part of diagnosing the scroll readiness race.
