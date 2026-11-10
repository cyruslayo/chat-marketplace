# 14 · Focus and announcements on workspace changes

Status: ready-for-agent
Type: task
Blocked by: none
Phase: 2 (Batch B)
Applicable ADRs: 0078; guideline §12 (focus follows task, one announcement, one H1)

## What to build

- **First surface:** `renderSurface` (`client.ts` ~2037-2067) moves focus only when one surface replaces another. The first workspace gets neither focus nor an announcement. Give it the same focus target and one "X is ready." announcement.
- **Double announcements:** check whether a new turn is read twice (the transcript `role=log aria-live=polite` plus `announce()`). Keep one source.
- **`#criteria-status`** (`guest-server.ts:603`) is a permanent `role=alert`. Make it `role=status`, and use the alert announcer only for errors.
- **Headings:** the shell H1 is the brand link (`guest-server.ts:558`), and workspace headings are sr-only H2s. Give each route one H1 that names the current task, with the brand no longer a heading. Record the decision and update the tests that match the brand H1.

## Acceptance criteria

1. The first workspace receives focus on its heading and is announced exactly once
2. A new assistant turn is announced once, not twice
3. Criteria status messages are polite, and only errors use the alert region
4. Each guest route has exactly one H1, naming the current task

## Rules

- Follow the AGENTS.md implementation protocol. List and read the ADRs that apply and record them in Comments. Write one named test per acceptance criterion, covering its failure paths.
- Use the kit (`.ui-*`, `guest-kit.ts`, `guest-content.ts`). No new components, no invented policy text or money, and no `any` in domain types.
- Test scope: `npm run check` plus this issue's own and affected tests. Record the exact commands and pass counts here. The full suite runs once per batch.
- Commit by explicit path only. Never stage `apps/local-guest/dist/*.js` (except a regenerated `client.js`), `apps/cloudflare/public/_headers` or generated screenshots. No stash, reset or clean.
- This issue changes `apps/local-guest/src/client.ts`. Never run it alongside another `client.ts` issue (11, 14, 19, 21, 24). Rebuild `client.js` and commit the regenerated `dist/client.js` only.
- Guest UI: finish with captures at 320, 390, 768 and 1280 (light and dark) under `.scratch/ux-guidelines/screenshots/<NN>/`, and a findings file showing no horizontal overflow and no control under 44px (ADR 0078).

## Comments
