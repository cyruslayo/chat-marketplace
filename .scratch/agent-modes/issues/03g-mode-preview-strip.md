# Preview other agent modes in a strip and a sheet (preview only, commit on first message)

Status: ready-for-agent
Type: task (UI; a real-browser test is in scope)
Blocked by: 03c (mode follows the active task and the client applies it), owner release as in 03a (ADR 0107 "Settled", 8 Nov 2026). The 10 Nov owner decisions apply: the app-bar mark is decorative and `aria-hidden` while one mode is registered, and "Concierge · Stays" shows only with more than one mode.
Requested: 10 Nov 2026

## Parent

[Agent modes architecture analysis](../architecture-analysis.md), section 9.3 (cycling through agents) and 5.6 (choosing a mode); [ADR 0107](../../../docs/adr/0107-present-each-domain-pack-as-an-agent-mode.md) decision 9 (choosing, and the 10 Nov amendment) and the 10 Nov persona wording; [01b](01b-agent-mark-for-the-stays-mode.md) (the mark is decorative with one mode); [map](../map.md) slice 5 (part 1).

## Why

With one mode the guest has no way to see or pick another agent. ADR 0107 decision 9 asks for a native radio strip (empty conversation) and a sheet from the app-bar mark (during a conversation). The strip previews a mode on the client from the presentations the server already sends in `verticals`. The first message or starter then commits it through `platform.task.start`. A preview creates no task and grants no authority.

Today: `#vertical-starters` exists (`apps/local-guest/src/client.ts:187`), `verticals` is returned with starters (`shortlet-app.ts`, `#verticals()`), the app-bar mark is decorative (01b), and only the stays presentation is registered (`guest-content.ts:725`). So the strip has nothing to show until a second pack is registered in a test composition. This issue is tested with the fake shop pack registered only in tests.

## What to build

1. **Strip.** When two or more modes are registered, render a native radio group, one radio per registered mode, in the empty conversation. Each label is a mark, the persona name and the tagline. Use `scroll-snap-type: x mandatory` only as layout; the checked radio is the only active state (ADR 0107 decision 9). Arrow keys move the choice.
2. **Preview on the client.** Checking a radio changes the heading, starters, composer placeholder and `data-preview-mode` on the strip only. It makes no request and changes no server state. The preview attribute is separate from `data-mode`, so a preview never looks like the committed mode.
3. **Commit.** The first message or a starter tap sends `platform.task.start { domain }` for the previewed mode before the turn, when the previewed mode differs from the committed one. The server's response mode is then applied (03c). If the start is refused, the client drops the preview and applies the server's mode.
4. **Sheet.** The app-bar mark becomes a labelled button only when two or more modes are registered: `aria-haspopup="dialog"`, a label with the active persona name and "Change concierge". It opens a modal `<dialog>` holding the same radio group as cards. A visible Close button closes it. Escape closes it. Focus returns to the mark. Opening adds no history entry (Android Back already closes a modal dialog, ADR 0107 decision 9).
5. **Choosing in the sheet** commits at once through `platform.task.switch` (the target has a task) or `platform.task.start` (it does not). If the current task has an open proposal, the card warns first, because the switch replaces the proposal (ADR 0074). The warning copy comes from `guest-content.ts`.
6. **Persona label.** "Concierge · Stays" is added to `guest-content.ts` and shown only when two or more modes are registered (owner, 10 Nov 2026). With one mode the label is absent and the shell is unchanged.
7. **Controls.** Every radio label, the mark button and the Close button are at least 44 by 44 CSS pixels (ADR 0078).
8. **No deep links or manifest shortcuts.** `/?start=<modeId>` and manifest `shortcuts` are out of scope (ADR 0107 decision 9; analysis 5.6).

## ADRs to read first

| ADR | Constraint | Where it lands |
| --- | --- | --- |
| 0107 decision 9 and 10 Nov amendment | Native radio group. Preview only; commit on first message or starter. Sheet is a modal dialog with Close, no history entry. The app-bar mark is decorative with one mode. | Steps 1 to 6. |
| 0107 decision 2 | The client changes the mode only through `platform.task.start` or `switch`. The server is the authority. | Steps 3 and 5. |
| 0107 decision 3 and 10 | Presentations are validated; a parked or disabled domain is not registered, so it gets no radio. | Steps 1 and 2 read `verticals` through `validateModePresentation`. |
| 0077 | Copy from one source. | Step 6 and the warning in step 5 live in `guest-content.ts`. |
| 0078 | 320px, reflow, 44px targets, focus stable, announcements. | Step 7; AC8. |
| 0080 | No-JS parity. The strip is a form or links, or the strip is omitted on the no-JS page (decide in Comments; default: omitted, and the page keeps the stays shell). | Step 1; AC9. |
| 0074 | A switch supersedes proposals; warn before. | Step 5. |
| 0076 | Human takeover never shows AI activity. | The mark button is not a control during `human` (human is unwired; state the rule in Comments). |

## Acceptance criteria

Each is its own `test()` in `test/agent-mode-preview.test.ts`, except AC6 which is the real-browser file `test/agent-mode-sheet-chromium.test.ts`.

1. With one registered mode, the rendered shell has no radio group, no "Concierge · Stays" label and the mark is `aria-hidden` and not a button (the default shell is byte-identical; `agent-mode-shell.test.ts` AC4 unchanged).
2. With two registered modes (fake shop pack in the test composition), the strip has one radio per registered mode, and each label's target is at least 44 by 44 CSS pixels.
3. Checking a radio changes the heading, starters and placeholder on the client and sends no request to the server (zero requests recorded by the test transport); the thread's task list is unchanged on re-read (no task created).
4. A malformed presentation in `verticals` is not rendered as a radio (fail closed); a presentation with an unregistered id is not rendered.
5. The first message after a preview sends `platform.task.start` for the previewed domain before the turn; the response mode then equals the previewed mode. A refused start leaves the server mode and the client shows that mode.
6. In Chromium, the sheet opens from the mark, has a visible Close button, closes on Escape and Close, returns focus to the mark, and adds no history entry (`history.length` is unchanged on open). Run this file solo.
7. "Concierge · Stays" appears only when two or more modes are registered, and the label text comes from `guest-content.ts` (a grep test finds no literal copy in `client.ts`).
8. A test of the rendered controls finds no interactive element under 44 by 44 CSS pixels, and no horizontal overflow at 320px.
9. The no-JS `/conversation` page renders the same stays shell with one mode and omits the strip with two (ADR 0080 decision recorded in Comments before code).

## Verification

- `env -u LLM_API_KEY npm run check`.
- Local: `env -u LLM_API_KEY npx tsx --test test/agent-mode-preview.test.ts test/agent-mode-shell.test.ts test/agent-mark-shell.test.ts test/guest-retired-classes.test.ts` (verify the last one applies to the changed CSS before running).
- Real Chrome, one file at a time, only this file for this screen: `test/agent-mode-sheet-chromium.test.ts`. Do not run two browser suites at once. `test/agent-mark-chromium.test.ts` runs solo afterwards, because the mark button changes.
- Captures: 320, 390, 768 and 1280 px, light and dark, with two modes registered in the test composition, saved under `screenshots/<issue number>/`. Also the one-mode captures, which must match the pre-issue captures.
- Record commands and counts under `## Comments`.

## Out of scope

- Deep links and manifest shortcuts.
- Swipe gestures on the app bar (ADR 0107 decision 9 forbids them).
- The automatic switch and the suggestion (03f).
- View Transitions, `theme-color` and the switch announcer (not assigned; see seams.md).
- Any real second domain, and any change to the stays copy.

## Comments
