# Keep each visited lane in memory and restore its scroll position on switch

Status: resolved
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

### Implementing agent (issue 03i, 17 Nov 2026)

**Owner decisions applied.** (1) Cache: `LANE_CACHE_LIMIT = 4` in `apps/local-guest/src/lane-cache.ts`. The visible lane counts toward it. The least recently used lane is dropped first, and its DOM is removed. (2) No "Continue" teaser. (3) Focus moves to the lane heading only after a switch from the switcher (rail, mode strip, mode sheet). A chip switch (origin "chip") and a server-made change (origin "server") leave focus alone. (4) The lane code writes nothing to browser storage. AC7 checks the module source, and the Chrome file counts `Storage.prototype.setItem` calls during switches (count 0).

**ADR and rule table.** Read in full or in relevant parts: 0107 (decisions 2, 6, 7, 11 and the corrections), 0106 (cold restore, fail closed), 0078 (320 px, 44 px, reflow), 0080 (no-JS parity), 0075 (no lane content in storage), 0079 (New conversation reloads the page), analysis 5.5 and 11.5, the 03g and 03h Comments, UX guideline section 12, `docs/agents/coding-standards.md`.

| ADR | Constraint | Where it lands |
| --- | --- | --- |
| 0107 decision 11 | Each lane is a live hidden subtree, in memory only. A switch replaces the history entry. | `transcript-lane` elements in `#transcript`, toggled with `hidden` (`shortlet-foundations.css`). `replaceHistoryEntry()` in `client.ts`. No `pushState`, no storage. |
| 0107 decision 2 | The client changes the mode only through `platform.task.start` or `platform.task.switch`. | `switchFromRail` and `sendTaskEvent` still send the event on every switch. The cache never skips it. |
| 0106 (cold restore, fail closed) | A cached lane is not authority. Unknown ids fail closed. | `planSwitch` shows nothing for a task the server does not list. `syncLanes` drops lanes the server no longer lists (`LaneCache.retain`). |
| 0078 | 320 px reflow, 44 px targets, no change to announcements. | AC10 in the Chrome file, and the captures. The live region is paused only while a lane is rewritten. |
| 0080 | The no-JS page is unchanged. | No change to the server shell or `renderNoScriptConversationHtml`. The `guest-shell`, `agent-mode-shell` and `guest-kit` tests pass. |
| 0075 | No lane content in browser storage. | AC7 in both files. |

**Design as built.**
- `lane-cache.ts` (pure, node-importable): `LaneCache<H>` (LRU, cap, `retain`, `bindThread`, `remember`), `planSwitch` (show cached, show fresh, or none; history `replace`; focus rule; scroll restore; reduced motion gives `instant`), and `timelinesEqual`.
- `client.ts` glue: `enterLane` shows a cached lane at once (or an empty lane), and the switch event then goes to the server. `loadVisibleLane` reads `/api/state` after the answer and rebuilds the lane from the server timeline when the timeline changed or the guest has added to the lane since. `syncLanes`, called first in `renderTaskRail`, makes the server's active task the visible lane. A refused switch returns to the previous lane.
- Cached lanes keep text only. Retry buttons and quick replies are removed when a lane is left, so a cached lane cannot send anything.
- Scroll restore is applied now and again after the next frame, because `addTurn` schedules its own scroll-to-end on that frame.
- A composer send is blocked while a task event is in flight (`taskEventInFlight`).
- The lane heading (`#route-heading`) gets `tabIndex = -1` from the client.

**Deviations, recorded.**
1. **AC1 reinterpreted (orchestrator rule).** The issue says "no request to `/api/event`". The switch event is still sent for every switch: ADR 0107 decision 2 requires it, and the server owns the active task. AC1 now means the cached lane is visible before the server answers. The Chrome test holds the switch request and checks the lane text while it is held.
2. **The switch response carries no timeline.** `/api/event` JSON has no `timeline` field; only `/api/state` does. The analysis said the switch response returns it. The client reads `/api/state` after the answer instead, so a switch makes two requests. This is the server-authoritative read that 03h left to 03i.
3. **Thread id change is not wired.** `LaneCache.bindThread` is implemented and tested (AC5), but the client never calls it. A new conversation reloads the page, which empties the in-memory cache anyway.
4. **Live region.** `aria-live` on `#transcript` is set to `off` while a lane is rewritten, so a restored lane is not announced as a whole. This was not checked with a screen reader.
5. **Chrome AC10 needs a test-side layout override.** The test sets the transcript's flex basis and `min-height` so the stays lane scrolls (the page CSS keeps it at 22dvh). No product style was added.
6. **Test-first, partly.** The node file was written first and run red: the module did not exist, so the file failed to load (`# tests 1, pass 0, fail 1`). The Chrome file was written after the client code. It was run red against the old bundle: AC1 failed with "lanes: 0" (no lane shown before the answer), and AC10 restored the scroll to 434, not 40. Both were green after the rebuild. This is recorded as a deviation from step 1.
7. **Storage.** The only `sessionStorage` use is the existing thread id, as before this issue. No lane content is written.

**Open finding (owner decision before merge to main).** The server's lane timeline does not hold the guest's own messages on this path. In a probe (the stays task, then "start a new task", then switch back), `/api/state` returned only `assistant:` rows, and the guest's search text was never in the lane rows. A reload gets the same rows, so this predates 03i. The new rebuild exposes it inside the session: after a switch back to a lane, the guest's own messages in that lane disappear until a reload shows the same thing. Fixing it means the assistant path must record user rows (the `userText` write in `#rememberResult` is not reached on that path). That is server work outside this issue. I did not change the server, and I did not add a client merge rule to hide it. Owner to decide: fix the server rows in a 03h follow-up before merge, or accept this for the pilot.

**Commands and counts** (each prefixed `env -u LLM_API_KEY`, run in `C:\AI2026\chat-marketplace-03i`):
- Red, node: `npx tsx --test test/agent-mode-lane-cache.test.ts` before the module existed: tests 1, pass 0, fail 1 (module load).
- Green, node, new file: `npx tsx --test test/agent-mode-lane-cache.test.ts`: tests 12, pass 12, fail 0.
- Red, Chrome, against the pre-build bundle: `npx tsx --test test/agent-mode-lane-cache-chromium.test.ts`: AC1 fails (`lanes: 0`), AC10 fails (scroll 434, expected 40).
- `npm run check`: exit 0 on the final tree (after the CRLF normalisation).
- Listed node set plus the new file: `npx tsx --test test/agent-mode-lane-cache.test.ts test/assistant-lane-read-path.test.ts test/assistant-task-lanes.test.ts test/agent-mode-preview.test.ts test/agent-mode-follows-task.test.ts test/agent-mode-announcement.test.ts test/agent-mode-theme-color.test.ts test/assistant-cold-journey.test.ts test/guest-focus-announcements.test.ts`: tests 81, pass 81, fail 0. This run came before the Chrome-driven fixes; the node files did not change afterwards.
- Wider node set (the listed set plus `assistant-task-rail`, `agent-mode-shell`, `shortlet-ui-foundations`, `guest-retired-classes`, `guest-kit`, `guest-shell`, `shortlet-design-system`, `agent-mark-shell`): tests 125, pass 124, fail 0, skipped 1. The skip is in `shortlet-ui-foundations`, is pre-existing, and needs `SHORTLET_FOUNDATIONS_BROWSER=1`.
- Real Chrome, solo: `npx tsx --test test/agent-mode-lane-cache-chromium.test.ts`: pass 2, fail 0 (final run).
- Real Chrome, solo: `npx tsx --test test/agent-mode-sheet-chromium.test.ts`: pass 5, fail 0.
- Real Chrome, solo: `npx tsx --test test/agent-mode-theme-color-chromium.test.ts`: pass 2, fail 0.
- Real Chrome, solo: `SHORTLET_TASK_RAIL_BROWSER=1 npx tsx --test test/guest-task-rail-chromium.test.ts`: pass 2, fail 0. The run rewrote eight PNGs under `.scratch/multi-domain-platform/screenshots/26`, which were restored with `git checkout --`.
- Build: `npm run build`, run twice. The second run confirmed that `dist/client.js` matches the final source. Unrelated build output (`dist/gallery.js`, `landing.js`, `offer.js`, `payment.js`, `apps/cloudflare/public/_headers`) was restored with `git checkout --`. Only `dist/client.js` is committed.
- Captures: `npx tsx .scratch/agent-modes/capture-03i.ts`. The stays lane after a rail switch, light and dark, at 320, 390, 768 and 1280 px: eight of eight have no horizontal overflow and no control under 44 by 44 CSS px. Files are in `.scratch/agent-modes/screenshots/03i/` (PNG and `findings.txt`), not committed.

**Definition of Done (`docs/agents/issue-tracker.md`).** (1) Each criterion AC1 to AC9 has a `test()` in `test/agent-mode-lane-cache.test.ts`. AC1, AC3, AC7 and AC10 also have Chrome tests in `test/agent-mode-lane-cache-chromium.test.ts`, which also checks focus. (2) Failure paths: forged id (AC6), dropped lane (AC4). (3) ADRs listed above. (4) No injected dependency. `LaneCache` takes only what it uses. `bindThread` is tested but not called by the client (deviation 3). (5) No invented policy: the cap is the owner's number. (6) No diagnostics added. (7) `npm run check` exit 0.

**Not covered.** A refused switch has no test. The code path reverts the lane and refreshes state. A chip-driven switch is covered only by the pure rule. The batch `npm test` and `npm run test:workers` were not run, per Test scope.

**Status.** Resolved, per the brief. The open finding above is for the owner before merge to main.
