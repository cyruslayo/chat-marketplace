# Move to `@cylayo/weaver-*` 0.2.1 from npm

Status: claimed
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
