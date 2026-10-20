# 15 · Verify the ported landing page on main (wave gate for 11, 12 and 14)

Status: ready-for-agent
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
