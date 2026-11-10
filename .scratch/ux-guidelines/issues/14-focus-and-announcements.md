# 14 · Focus and announcements on workspace changes

Status: resolved
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

### ADRs read and applied

| ADR | Constraint | Where it applies |
| --- | --- | --- |
| 0078 | Focus follows task, one meaningful announcement, one H1 and logical headings, status in words. | AC1-AC4. |
| 0080 | Chat and standard routes carry the same task facts. | The route H1 names the current task on the chat shell; standard pages keep their own H1. |

### Implementation

- `acceptSurface` treats the first workspace as a task transition (`firstSurface`), so it uses the same focus path as a replaced surface.
- `renderResponse` sets `transcriptAnnouncesTurn` when the turn adds an assistant message; `renderSurface` then focuses without repeating the ready sentence, so the transcript log is the one announcement source. Surface-only changes still announce.
- `#criteria-status` is `role="status"`; `#error-announcer` remains the assertive alert region for errors.
- The brand is a `span` inside the brand link, not a heading. The shell has one `h1#route-heading` that starts as the empty-state task and is updated by `renderSurface`/`closeWorkspace` to the current task.

### Tests and commands

- `npm run check` — 0 errors.
- `npx tsx --test test/guest-focus-announcements.test.ts test/agent-mode-shell.test.ts test/agent-mark-shell.test.ts` — 18 tests, 18 passed, 0 failed.
- Real Chrome: `npx tsx --test test/guest-focus-announcements-chromium.test.ts` — 2 tests, 2 passed, 0 failed (first workspace focus, one H1 naming the task).
- `client.js` rebuilt; only the regenerated `dist/client.js` is staged.
- Captures: `npx tsx .scratch/ux-guidelines/capture-14.ts` — 8 captures at 320/390/768/1280 in light and dark under `.scratch/ux-guidelines/screenshots/14/`; findings show one H1, no horizontal overflow and no visible control under 44px.

## Answer

The first workspace now receives focus like any later replacement, a turn with an assistant message is announced once by the transcript, the criteria strip is polite, and the chat route has one H1 that names the current task while the brand is no longer a heading.
