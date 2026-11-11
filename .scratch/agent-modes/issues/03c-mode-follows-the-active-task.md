# Derive the mode from the active task and apply it on the client

Status: ready-for-agent
Type: task
Blocked by: 03a (presentation on the pack). 03b is not required for the stays-only path, but the fake-pack switch test in AC1 and AC9 needs 03b's persisted `activeTaskId`. Owner release as in 03a (ADR 0107 "Settled", 8 Nov 2026).
Requested: 10 Nov 2026

## Parent

[Agent modes architecture analysis](../architecture-analysis.md), section 5.1 (derived mode), 5.3 (wire), 5.4 (tokens); [ADR 0107](../../../docs/adr/0107-present-each-domain-pack-as-an-agent-mode.md) decisions 2, 4, 5 and 6; [map](../map.md) slice 4 (part 1).

## Why

The mode is still a constant. `shortlet-app.ts:787` sets `readonly #defaultMode: ModePresentation = GUEST_MODES.stays`, and every response takes it (`shortlet-app.ts:2100` and `:2113`). Switching the active task changes the agent but not the mode.

Facts the survey found, which change the earlier brief:

- The server already writes the attribute: `renderGuestShellHtml(mode)` emits `<html lang="en-NG" data-theme="system" data-mode="stays">` (`apps/local-guest/src/guest-server.ts:337`). The stays snapshot test (`test/agent-mode-shell.test.ts`, AC4) expects that exact tag.
- The client never updates the attribute on `document.documentElement`. Its applied mode is only the variable `appliedMode` (`apps/local-guest/src/client.ts:1518`, applied by `applyResponseMode` at `:1520`). It is used for announcements.
- The name `data-mode` is already used on `#active-workspace` for the workspace presentation (`focused-surface` and `inline-surface`; `client.ts:1967`, many selectors in `guest-server.ts`). The two are different elements, so selectors do not collide. Tests must prove it.
- The foundation CSS has no `--mode-*` token today (zero matches in `apps/web/src/shortlet-foundations.css`). Its Guest UI kit block starts at line 431.
- There is no `<meta name="theme-color">` in the guest source (searched `apps/local-guest/src` and `apps/web/src`).

## What to build

1. **Derive the mode.** Replace `#defaultMode` with `#modeFor(thread)`: the `presentation` of the pack that owns the thread's active task (`thread.tasks.find(active).domain`). With no task, or an unregistered domain, the default pack's presentation (stays). The stays value is the same object (`GUEST_MODES.stays`), so the stays output is unchanged.
2. **Carry it everywhere.** Every response and the state read (`/api/turn`, `/api/event`, `getState`) carries `mode` from `#modeFor`, on the assistant and non-assistant paths (as `#withJourney` does today, `shortlet-app.ts:2110` to `:2120`).
3. **Client applies it, never sets it.** After each validated response, the client calls `readResponseMode(response.mode)` (`response-mode.ts`) and, when the id differs from `document.documentElement.dataset.mode`, writes the id. It never reads a mode from a user action or from the DOM.
4. **Token blocks.** In the Guest UI kit block of `apps/web/src/shortlet-foundations.css`, add `:root[data-mode="stays"]` defining `--mode-accent`, `--mode-accent-subtle`, `--mode-on-accent` and `--mode-tint`, with the light value, `:root[data-theme="dark"]` and `:root:not([data-theme="light"])` under `@media (prefers-color-scheme: dark)`, the existing three-place pattern. The stays values equal the current `--color-*` values, so nothing changes visually. Keep the committed formatting. Do not run a formatter on this file.
5. **Test-only fake-shop tokens stay out of the shipped CSS.** The fake pack's token block lives in `test/fixtures/mode-fixture.css`, read and injected only by test harnesses. The shipped stylesheet contains no `shop` selector. A test asserts this by reading the shipped file.
6. **Attribute name.** Keep `data-mode` on `<html>`, as ADR 0107 decision 4 names it. Do not rename the workspace attribute.

## ADRs to read first

| ADR | Constraint | Where it lands |
| --- | --- | --- |
| 0004 | The browser is not an authority. | Step 3: the client writes only what a validated response says. |
| 0073, 0081 | No CSS or HTML from the agent or the client; closed catalogues. | Steps 4 and 5: tokens are static CSS; the fake block is test-only. |
| 0077 | One copy source. | The mode carries no copy in this issue. |
| 0078 | 320px, reflow, WCAG 2.2 AA contrast, reduced motion. A mode changes accents only. | Step 4 changes colour tokens only; AC5 checks contrast. |
| 0080 | Deterministic parity: the no-JS page renders the same mode. | The server writes `data-mode` on `<html>` in the first response (already true). AC4 keeps the default shell byte-identical. |
| 0099 decision 4 | Packs declare; the platform renders. | The pack declares `presentation`; CSS is platform-owned. |
| 0101 | One Worker, one thread, many tasks. | The mode follows the thread's task. |
| 0104 | Commerce off. Parked packs are not registered. | No commerce mode is registered. |
| 0106 | Cold restore before every event. | AC9. |

ADR 0107 decision 4 also says "Components read `--mode-*`, never a hex value". Components do not read the tokens in this issue, because nothing changes visually: record in Comments that the tokens are defined and unused until 03g.

## Acceptance criteria

Each is its own `test()` in `test/agent-mode-follows-task.test.ts`.

1. With the stays pack and the fake shop pack registered, starting a shop task makes the next response carry `mode.id === "shop"`, and switching back makes it `"stays"`.
2. A request body that includes a `mode` value does not change the response mode; the server ignores it.
3. A thread whose active task names an unregistered domain carries the default mode and the existing refusal; no mode from the client is used.
4. `renderGuestShellHtml()` with the default mode equals the pre-agent-modes snapshot with `data-mode="stays"` on `<html>` (`test/agent-mode-shell.test.ts` AC4 unchanged).
5. Every registered presentation id has a complete `--mode-*` token block (all four tokens in light, forced-dark and system-dark), and each accent pair meets WCAG 2.2 AA (4.5:1 for text pairs) against `--color-surface`.
6. The shipped `shortlet-foundations.css` contains no selector for the fake pack id `shop`.
7. The client writes `document.documentElement.dataset.mode` only from a validated response: a malformed `mode` leaves the attribute unchanged.
8. A mode switch does not change `#active-workspace`'s `data-mode` (the workspace attribute stays `focused-surface` or `inline-surface`).
9. After a cold restore with the shop task active, the state read and the next response both carry `mode.id === "shop"`.

## Verification

- `env -u LLM_API_KEY npm run check`.
- `env -u LLM_API_KEY npx tsx --test test/agent-mode-follows-task.test.ts test/agent-mode-shell.test.ts test/assistant-task-rail.test.ts`.
- The foundation CSS tests that match the Guest UI kit block (find by `grep -l "shortlet-foundations" test/*.ts`; run only those that read the file).
- `env -u LLM_API_KEY npx tsx --test test/assistant-cold-journey.test.ts` (assistant enabled, cold restore before every event, clock 2026-10-27, staging-like guest). This is the mode journey for AC9.
- Because a shared CSS and a shell change are in scope, AGENTS.md "Guest UI work" requires the sweep: run `capture-11-all.sh` in the background, one group at a time, and compare to the pre-issue captures. Expected diff: none for stays. Save any new captures under `screenshots/<issue number>/`. Do not stage `_headers`, `dist/*.js` or the screenshots.
- Record commands and counts under `## Comments`.

## Out of scope

- The preview strip and the sheet (03g).
- Any switch that is not a `platform.task.start` or `switch` event (03f).
- View Transitions, `theme-color` and the switch announcer (not assigned; see seams.md).
- Using `--mode-*` in components.

## Comments
