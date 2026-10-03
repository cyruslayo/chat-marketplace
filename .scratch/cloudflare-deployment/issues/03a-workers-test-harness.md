# Workers test harness and `apps/cloudflare` skeleton

Status: ready-for-agent
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
