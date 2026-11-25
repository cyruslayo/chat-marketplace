# Bring the design and surface documents onto this branch

Status: resolved
Type: task
Blocked by: none (D1 accepted 25 Nov 2026)

## Why

`main` has no ADR 0108, no `docs/design/shortlet-ui-surfaces.md`, no kit parity audit and no `.scratch/surface-catalogue-library/`. They are in four commits on `docs/ux-guidelines` (69c9ac4, 543cdb5, 0c90012, 344c68b). 69c9ac4 is also on `feat/surface-kit-phase-1`.

## What to build

- Cherry-pick the four commits onto `docs/app-expansion`, oldest first.
- Conflicts were seen in weaver-catalogues issues 04–07 only. Keep `main`'s text (those issues are resolved) and add the branch's pointer to ADR 0108 as a new Comment.
- Add two dated notes, without rewriting history: the surface plan's §6 and §7 say extension and Notice to End have no command, but both are wired on `main`; the kit audit's §5 is still the token mapping.

## Acceptance criteria

- AC1: `docs/adr/0108-*.md` and the three documents exist on the branch, and `git diff main -- apps domains packages test` is empty.
- AC2: weaver-catalogues 04–07 keep `Status: resolved` and their answers.
- AC3: `npm run check` is clean.

## Tests

Documents only: `npm run check` and `npx tsx --test test/state-machine-inventory.test.ts`.

## Answer

Resolved 25 Nov 2026. The four commits were cherry-picked (19cd946, 4cbc1aa, ab719bc, be8f60c). Conflicts were only in weaver-catalogues 04-07: `main`'s text was kept and the branch's comment added below it, with a dated note that the typed components landed first.

## Comments

- AC1: met with one correction to its wording. `git diff main -- apps domains packages test` shows only `packages/platform-core/CONTEXT.md` (12 glossary lines from 69c9ac4). No code or test differs.
- AC2: met. All four keep `Status: resolved`.
- AC3: `npm run check` clean; `npx tsx --test test/state-machine-inventory.test.ts` passes.
- Documents only, so there are no per-criterion tests and the full suite was not run.
- `.scratch/surface-catalogue-library/map.md` still lists its issues 01-05 as ready-for-agent; they are resolved on `feat/surface-kit-phase-1` (issue 02).
