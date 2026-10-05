# Workers test harness and `apps/cloudflare` skeleton

Status: resolved
Type: task
Blocked by: 01a, 01c
Branch: `infra/cf-03a-workers-harness`
Requested: 2 Oct 2026
Unlocks: 03b, 07b, 09b, 09c

## Why

Every later Cloudflare slice needs tests that run inside workerd, separate from the Node test runner. This slice sets up only the harness, with one trivial Durable Object test, so later slices just add specs.

## What to build

- Use the pinned `cf` toolchain from 01c for project development and builds. Add `@cloudflare/vitest-pool-workers`, `vitest` (the compatible version) and the required Workers types as project-pinned devDependencies. Include/pin Wrangler only if required by the selected test pool, and document it as test infrastructure rather than a project CLI.
- `apps/cloudflare/`:
  - A minimal test-pool config, separate from the production `cloudflare.config.ts`, with `nodejs_compat`, a current compatibility date, one SQLite-backed Durable Object (`TestHarnessDO`) and R2 buckets `RECEIPTS` and `EXPORTS` for later slices. Use only the test-pool config format confirmed by 01c.
  - `src/test-harness-do.ts`, a minimal Durable Object.
  - `test/harness.spec.ts`, which uses `runInDurableObject` to run `ctx.storage.sql.exec("SELECT 1")` and asserts the result.
  - `vitest.config.ts` (workers pool).
  - `tsconfig.json`, which extends the root options, uses `types: ["@cloudflare/workers-types", "@cloudflare/vitest-pool-workers"]`, and includes only `apps/cloudflare/**`.
- Root `tsconfig.json`:
  - **exclude `apps/cloudflare/**`**, because it includes `apps/**/*` with Node types today;
  - make `npm run check` run both, for example `tsc --noEmit && tsc --noEmit -p apps/cloudflare`.
- `package.json`: add `"test:workers": "vitest run --config apps/cloudflare/vitest.config.ts"`. `npm test` must not pick these up: `scripts/run-tests.mjs` reads only top-level `test/*.test.ts`, so use `.spec.ts` under `apps/cloudflare/test/`.
- `.gitignore`: add `.cloudflare/` and any test-runtime local state directory identified by 01c.

## Out of scope

- The production `cloudflare.config.ts`, Worker and real Durable Object assembly (10b).
- Any adapter code (03b).

## Acceptance criteria

- AC1: `npm run test:workers` runs the harness spec in workerd and passes.
- AC2: `npm run check` type-checks both the Node tree and `apps/cloudflare` with their own `types`. Failure path: a deliberate Node-only API used in `apps/cloudflare` fails the check (verify by hand, and record that in `## Comments`).
- AC3: `npm test` neither runs nor breaks on the `.spec.ts` files, and still passes.
- AC4: No production Wrangler config or developer-facing Wrangler command is introduced by this harness. Any Wrangler requirement is limited to the test pool and documented.

## ADR compliance

No domain ADRs. This slice is tooling only.

## Definition of Done

Check every item in `docs/agents/issue-tracker.md`. Item 7 also covers `npm run test:workers`.

## Comments

- Implementation selection: unblocked by merged 01a/01c. Follow 01c's verified `@cloudflare/vitest-plugin@1.3.6` / Vitest 4.1.11 integration rather than guessing a legacy pool configuration. Wrangler remains transitive test infrastructure only.

| ADR | Constraint | Acceptance / code path |
| --- | --- | --- |
| 0095 | SQLite-backed DO; no authority in front-door Worker | AC1 test harness only, synthetic data; no production binding or deployment |

- No domain logic changes in this tooling slice.
- AC2 negative probe: temporary `src/node-only-probe.ts` imported `DatabaseSync` from `node:sqlite`; Worker-source tsc failed with TS2591. Removed probe and `npm run check` passed. Source, tests and Node-hosted tooling have separate configs: Vitest references Node types, so mixing tests into the source check would mask this failure. Workers-types declares a compatibility `process` global, so `process.cwd()` is not a suitable negative probe.
- npm 10.9.3 initially failed dependency installation with `Cannot read properties of null (reading edgesOut)`; exact pins installed successfully using `--legacy-peer-deps`. `npm ls` and runtime checks succeed.
- First full test attempt raced a package.json edit (two invalid-package reads); AC22 in the existing verification test also matches the harness variable `PI_REASONING_LEVEL` via its broad `/NIN/i` check. Stable rerun with only that variable unset passed; no domain/test policy changes were made.

## Verification and Definition of Done

1. AC1 has a workerd `test()` in `apps/cloudflare/test/harness.spec.ts`; AC2–AC4 have separate named Node tests in `test/cloudflare-harness.test.ts`. All were observed failing before implementation.
2. AC2's named failure path was reproduced by hand (TS2591); configurations exclude Workers specs from the Node runner. No other failure paths specified.
3. ADR table rechecked: SQLite-backed synthetic DO only; no production authority or deployment. ADR 0095 read; slice has no domain ADR constraints.
4. All injected bindings/dependencies used by the harness; R2 bindings reserved explicitly by this issue for subsequent slices.
5. No invented domain policies or constants.
6. No bearer or restricted identity data in harness records/logs.
7. `npm run check`, `npm run test:workers` (1 passed), and full `env -u PI_REASONING_LEVEL npm test` passed: 1,265 non-browser tests; 165 browser tests; zero failures; one expected skip. Log: `/tmp/cf-wave2-03a-clean-tests.log`. Whitespace check passed. Active LSP returned stale/inferred-project Cloudflare module findings; project tsc is clean for each explicit config.

## Answer

Implementation committed in `492982a` before resolution. Implemented the isolated workerd harness with SQLite `TestHarnessDO` and simulated R2 bindings. Exact pins: Vitest 4.1.11, Workers plugin 1.3.6, Workers types 5.20261005.1. The verified 01c plugin supersedes the issue's legacy pool-package name; Wrangler 4.147.0 is transitive test infrastructure only. Existing ignore rules already cover generated runtime state. No production Worker/config exists in this slice, so `cf build` / deployment dry-run are not applicable until assembly (10b).