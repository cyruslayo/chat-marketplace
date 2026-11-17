# 08 One SurfaceLifecycleStatus

Status: resolved
Type: task
Track: B (no behaviour change)
Blocked by: 01

## What to build

`SurfaceLifecycleStatus` is declared twice, with the same members: in `packages/platform-core/src/surface.ts` and in `apps/local-guest/src/conversational-shell.ts`. Make the platform-core declaration the only one:

- Add `SURFACE_LIFECYCLE_STATUSES = ["active", "superseded", "stale", "expired", "deleted", "fallback"] as const` in `surface.ts`, and derive the type from it.
- In `conversational-shell.ts`, use `export type { SurfaceLifecycleStatus } from …` so existing importers keep working.
- Before you remove the copy, check it is browser-safe. `conversational-shell.ts` is bundled into the browser client (`client.ts`), and `surface.ts` must not pull Node-only code into the client bundle.
  - A type-only re-export is erased at compile time, so it is safe.
  - A runtime import of the const array into client code would not be safe. If you need the array on the client, keep only the type re-export and do not import the array there.

Do not add from-state guards to `surface.ts`; issue 17 does that.

Update the surface rows in `docs/agents/state-machines.md` so the ratchet stays green.

## Acceptance criteria

1. `SurfaceLifecycleStatus` is declared exactly once, in `packages/platform-core/src/surface.ts`. A test greps the four scanned folders and finds one declaration.
2. The client bundle builds unchanged. `npm run check`, including `scripts/check-worker-bundle.mjs`, is clean, and the client still type-checks.

## Tests

- Add `test/surface-lifecycle-single-union.test.ts`.
- Re-run every test whose name contains `surface-lifecycle` or `conversational-shell`, plus `test/state-machine-inventory.test.ts`.
- Run `npm run check`.

ADRs: 0074.

## Comments

- Red first: `env -u LLM_API_KEY npx tsx --test test/surface-lifecycle-single-union.test.ts` gave 0 pass, 2 fail before the change.
- Change: `SURFACE_LIFECYCLE_STATUSES` plus derived `SurfaceLifecycleStatus` in `packages/platform-core/src/surface.ts`. `conversational-shell.ts` now has a type-only import and `export type { SurfaceLifecycleStatus }`. The map rows in `docs/agents/state-machines.md` were updated.
- ADRs read: 0074 in full, 0106 in full (no constraint touched: the change is type-only, no runtime or restore path). ADR 0041 and 0043 are unaffected.
- Green: `env -u LLM_API_KEY npx tsx --test test/surface-lifecycle-single-union.test.ts test/surface-lifecycle-extension.test.ts test/conversational-shell.test.ts test/state-machine-inventory.test.ts`: tests 16, pass 16, fail 0.
- `env -u LLM_API_KEY npm run check`: exit 0 (tsc for root, apps/cloudflare, tests and tooling, then the worker bundle guard passed).
- Client bundle: an in-memory esbuild bundle of `apps/local-guest/src/client.ts` (same options as `apps/local-guest/scripts/build-client.mjs`) is byte-identical to the committed `apps/local-guest/dist/client.js` (572624 bytes). `dist/` was not regenerated.
- Not run, per the batch gate: full `npm test` (DoD item 7 is deferred to the batch gate as the orchestrator directed), `npm run test:workers`, real-Chrome tests.
- Orchestrator review: type-only change read; re-ran the 4 files (16 pass) and `npm run check` (exit 0).
