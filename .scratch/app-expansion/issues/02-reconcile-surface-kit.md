# Reconcile the shared component library with the typed components on main

Status: ready-for-agent
Type: research
Blocked by: none

## Why

ADR 0108 planned the library first and the typed components second. They landed the other way round. `main` has typed `StayCard`, `StayResults`, `StayTicket`, `PriceBreakdown`, `UnitDetail` and `StayComparison` (weaver-catalogues 04–08). Library phase 1 is complete but unmerged on `feat/surface-kit-phase-1` (7 code commits, base 78135f7). A trial merge conflicts in `shortlet-catalogs.ts`, `shortlet-runtime.ts`, `weaver-dependency-boundary.test.ts`, `dist/client.js` and four issue files.

Until this is settled, a new chat component has no format to land in.

## Question

How do the typed components on `main` become library components without changing what a stored or open chat renders?

## What to produce

A note `notes/02-surface-kit.md` in this effort, and no code:

1. For each typed component: its schema on `main`, whether it fits `defineSurfaceComponent` unchanged, and any prop the library cannot express.
2. Whether the composed catalogue can stay byte-identical to `main`'s. If not, the exact differences, and whether ADR 0108 decision 6 makes them minor or major.
3. The merge order with the smallest diff, and the tests that prove there is no wire change (`test/catalogue-snapshots.test.ts` on the branch).
4. One recommendation, with the decision the owner must make, if any. No new catalogue ID (ADR 0073).

## Acceptance criteria

- AC1: Every typed component on `main` has a row.
- AC2: Each claim of "unchanged" is shown by a command and its output, run in a scratch worktree. Nothing is merged or pushed.
- AC3: The note names the follow-up issues it implies.

## ADR compliance

0073 (no new ID), 0081, 0102, 0106 (old chats restore), 0108.

## Comments
