# Keep each visited lane in memory and restore its scroll position on switch

Status: needs-triage
Type: task (UI; a real-browser test is in scope)
Blocked by: 03d (resolved: lanes exist and each has a `taskId`), 03g (strip and sheet, on branch `feat/agent-modes-03g`, not merged; it supplies the switch controls). Owner release before any build (ADR 0107 "Settled", 8 Nov 2026).
Requested: 16 Nov 2026

## Open owner decisions

1. **Cache size.** How many lanes stay live in memory at once? Analysis 11.5 gives no number. Owner to set a named constant; the least recently used lane is dropped first.
2. **Teaser.** Analysis 11.5 wants a one-line "Continue: Stays · Offer ready" teaser for a lane that is not loaded yet. Its copy is an owner decision. Recommendation: out of this issue.
3. **Focus after a switch.** Analysis 5.5 moves focus to the lane heading only when the guest switched from the switcher; a switch from a chip leaves focus alone. Owner to confirm.
4. **Reload.** The cache does not survive a reload, so a reload asks the server (analysis 11.5: "a full reload asks the server, which is always right"). Owner to confirm; no browser storage is used (see step 6).

## Parent

[Agent modes architecture analysis](../architecture-analysis.md), section 11.5 (client) and 11.6 (slice 4, expanded); [ADR 0107](../../../docs/adr/0107-present-each-domain-pack-as-an-agent-mode.md) decision 11 ("Client": a live hidden subtree, in memory only, a switch replaces the history entry). Map slice `5-cache`.

## Why

Facts from the survey:

- The client has no lane swap. It keeps one transcript: `addTimelineEntry` appends to it (`apps/local-guest/src/client.ts:1733`), and responses add their timeline entries to it (`client.ts:2794` to `:2797`). The multi-task restore path renders no timeline at all (`client.ts:3018` to `:3024`). Whether a task-switch response replaces the transcript is not settled by this survey; the implementer reads `renderResponse` (`client.ts:2691`) first.
- The server keeps every non-active lane's timeline (`laneTimelines`, `apps/local-guest/src/shortlet-app.ts:748`, `:2205` to `:2207`). The client keeps none of them.
- Task rail switches post `platform.task.switch` or `platform.task.start` through `/api/event` (`client.ts:2236` to `:2237`, and the rail handler after it).
- `client.ts:1615` uses `history.replaceState`, and `client.ts:1976` uses `history.pushState` for the workspace sheet. A lane switch must reuse neither for its own history step: it replaces the entry (ADR 0107 decision 11).
- "New conversation" starts a fresh thread (owner decision O5, 12 Nov 2026), so cached lanes must be cleared when the thread id changes.

## What to build

1. **In-memory cache.** A `Map` keyed by `taskId` holds, for each visited lane, its transcript as a live subtree kept with `hidden` or `content-visibility: hidden`. Subtrees are never detached and re-inserted (ADR 0107 decision 11). `moveBefore()` may be used only as an enhancement.
2. **Scroll memory.** Before leaving a lane, the client records its transcript `scrollTop`. Arriving at a cached lane restores that value after the lane is visible.
3. **Switch from the cache.** A switch to a cached lane shows it without a request to the server. A switch to an uncached lane uses the timeline the response carries and caches it.
4. **History.** A lane switch calls `history.replaceState` and never `pushState`.
5. **Clear and evict.** The cache is cleared when the thread id changes. When the cache is full (owner decision 1), the least recently used lane is dropped and the next switch to it reads the server.
6. **No browser storage.** Nothing from a lane is written to `localStorage`, `sessionStorage` or IndexedDB.
7. **Authority.** A cached lane never authorises a control. The server's task list is checked on each switch; a cached lane whose `taskId` is missing from that list is dropped (ADR 0106).
8. **No-JS page.** `/conversation` keeps rendering the active lane only, with the task rail as links (ADR 0080). This issue does not change it.

## ADRs to read first

| ADR | Constraint | Where it lands |
| --- | --- | --- |
| 0107 decision 11 (Client) | Live hidden subtree, in memory only, `moveBefore()` as enhancement only, a switch replaces the history entry. | Steps 1 to 4. |
| 0107 decision 7 and analysis 5.5 | Focus moves to the lane heading only when the switch came from the switcher. Reduced motion handled in 03j. | Owner decision 3; AC 9. |
| 0106 (cold restore; tools and context) | Every request is a cold restore. A cached lane is not authority; ids are re-keyed or fail closed. | Steps 3 and 7; AC 4 and 6. |
| 0079 (New conversation) | "New conversation" is a fresh thread with no lanes carried over. | Step 5; AC 5. |
| 0078 | 320 px reflow, stable focus, 44 px targets, no change to announcements. | AC 10 and the captures. |
| 0080 | No-JS parity: the no-JS page is unchanged. | Step 8. |
| 0075 | No lane content in browser storage. | Step 6; AC 7. |

## Acceptance criteria

Each is its own `test()` in `test/agent-mode-lane-cache.test.ts` (new), except AC 10, which is the real-browser file `test/agent-mode-lane-cache-chromium.test.ts` (new).

1. Switching to a visited lane shows its transcript from memory with no request to `/api/event`.
2. Switching back to a lane restores the scroll position the guest left it at.
3. A lane switch replaces the history entry: `history.length` is unchanged and `pushState` is not called.
4. A cached lane whose `taskId` is missing from the server's task list is dropped and is not shown (fail closed).
5. Changing the thread id clears every cached lane.
6. An unknown or forged task id never shows a cached lane.
7. No lane content is written to `localStorage`, `sessionStorage` or IndexedDB.
8. The cache never holds more lanes than the owner's cap, and the least recently used lane is dropped first.
9. Focus moves to the lane heading only when the switch came from the switcher, and stays put after a chip-driven switch.
10. In Chromium at 320 px, a lane's scroll position survives two switches away and back, with no horizontal overflow.

## Verification

- `env -u LLM_API_KEY npm run check`.
- Local: `env -u LLM_API_KEY npx tsx --test test/agent-mode-lane-cache.test.ts test/agent-mode-follows-task.test.ts test/assistant-task-rail.test.ts`.
- Real Chrome, one file at a time, solo: `test/agent-mode-lane-cache-chromium.test.ts`, then `test/guest-task-rail-chromium.test.ts` (the rail switch changes).
- Captures at 320, 390, 768 and 1280 px, light and dark, saved under `screenshots/<issue number>/`.
- Record the exact commands and pass counts under `## Comments`.

## Out of scope

- The teaser (owner decision 2).
- Persisting the cache across a reload (owner decision 4).
- The server read path for lanes (03h).
- The switch animation (03j) and the announcement (03l).
- Any change to the no-JS page.

## Comments
