# 08 One SurfaceLifecycleStatus

Status: ready-for-agent
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
