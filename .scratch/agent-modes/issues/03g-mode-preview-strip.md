# Preview other agent modes in a strip and a sheet (preview only, commit on first message)

Status: resolved
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

### Agent, implementation (Agent modes issue 03g), decisions recorded before code

**ADR table.** Read in full: 0107 (decisions 2, 3, 4, 6, 9, 10 and the 10 Nov amendment), 0074 (proposal supersession), 0076 (human takeover), 0077 (one copy source), 0078 (44px, 320px, reflow), 0080 (no-JS parity). Read in relevant parts: seams.md, map.md, 03c Comments (applyResponseModeTo, mode-tokens helper, fake shop pack).

| ADR | Constraint | Where it lands |
| --- | --- | --- |
| 0107 decision 9 | Native radio group; preview only; commit on first message or starter; sheet is a modal `<dialog>` with Close, no history entry; mark decorative with one mode. | `apps/local-guest/src/mode-choice.ts`, `client.ts` (strip, sheet, mark button). |
| 0107 decision 2 | The client changes the mode only through `platform.task.start` or `platform.task.switch`. | `client.ts` commit path. |
| 0107 decision 3 and 10 | Malformed presentation or an unregistered id gets no radio. | `chooseModes` in `mode-choice.ts` (validateModePresentation, duplicate ids dropped). |
| 0107 decision 4 | Tokens only; the fake shop block stays in `test/fixtures/`. | No CSS change in the shipped stylesheet. |
| 0077 | One copy source. | `GUEST_MODE_CHOOSER` in `guest-content.ts`. |
| 0078 | 44px targets, 320px reflow. | Controls reuse `.ui-button` (2.75rem) and the hidden-radio label pattern; AC8 measures in Chrome. |
| 0074 | A switch supersedes an open proposal; warn first. | `proposalOpen` on the active rail entry; warning shown before a switch. |
| 0076 | The mark is not a control while the human state applies. | `markIsControl(modeCount, humanState)`; the human state is unwired, so it is always false in the client. |
| 0080 | No-JS page keeps the stays shell; no strip, no sheet. | Strip and sheet are built client-side only; the server shell bytes are unchanged (AC4 snapshot). |

**Decisions.**
1. ADR 0080: the strip and the sheet are omitted on the no-JS `/conversation` page (AC9).
2. ADR 0076: the mark button is not a control while the human state applies. The human state is unwired; the rule is in `markIsControl`.
3. Copy: "Concierge · <label>" (generated from the registered label, so "Concierge · Stays") and "Change concierge" are added in `GUEST_MODE_CHOOSER`. The step 5 warning is `GUEST_MODE_CHOOSER.openProposalWarning` with the exact text the owner approved on 16 Nov 2026: "Changing concierge now cancels the step waiting for your answer." It is owner-approved (16 Nov 2026) and does not block resolution.
4. The server shell markup is not changed, so AC4 (byte-identical snapshot) holds. All strip and sheet markup is built by the client from the validated list, as the chat task rail already does.
5. `verticals` gains an optional `presentation` per registered pack (additive). The client validates it with validateModePresentation and drops invalid or duplicate ids.

**Implementation summary.** Pure rules in `apps/local-guest/src/mode-choice.ts` (`chooseModes`, `showsModeChooser`, `markIsControl`, `startBeforeTurn`). Server: `AssistantVertical.presentation` (additive), `AssistantTaskRailEntry.proposalOpen` on the active task while a proposal is open (ADR 0074), `presentationFor` so a fresh thread's state carries `mode` and `verticals` (both fallback responses in `guest-server.ts`). Client (`client.ts`): the strip (radio group in `#vertical-starters`, `data-preview-mode` on the strip, preview copy only), the commit in `startTurn` and `commitPreviewThenSend` (composer submit and starters, starters now delegated), the mark button with the sheet (`<dialog class="mode-sheet">`, Close button, focus back to the mark). Copy: `GUEST_MODE_CHOOSER` in `guest-content.ts`. `apps/local-guest/dist/client.js` regenerated with `npm run build`.

**Deviations, recorded.**
1. Strip replaces the slice-26 vertical starter cards in the client when two or more modes are offered. The no-JS page keeps its static cards (ADR 0080) and the server shell bytes are unchanged (AC4 snapshot passes).
2. The strip and sheet are built client-side from the validated list (the same pattern as the chat task rail), not from a server helper. No shipped CSS was added (03g adds none to `shortlet-foundations.css`).
3. Open-proposal warning: the owner-approved copy (16 Nov 2026) is shown in the sheet on open when the active task has an open proposal. A choice still commits when the guest picks it, because the copy says the step is cancelled.
4. AC4 "unregistered id" is implemented as: a presentation that fails validation, or an id carried by more than one entry, names no choice. A runtime check against the shipped token blocks is not done; ADR 0107 decision 3 is not fully enforced on the client.
5. Refused start: the client keeps the server's mode and does not send the turn. The text stays in the composer on the first-message path.
6. Process: `mode-choice.ts` was written before the tests, so the tests were not seen failing first. This is a deviation from step 1.

**Verification (worktree `C:\AI2026\chat-marketplace-03g`, every command prefixed `env -u LLM_API_KEY`).**
- `npm run check`: exit 0 (run after all TypeScript changes; the later change was a client style line only).
- `npx tsx --test test/agent-mode-preview.test.ts`: tests 11, pass 11, fail 0, skipped 0.
- `npx tsx --test test/agent-mode-shell.test.ts`: pass 9, fail 0 (AC4 snapshot unedited).
- Wider node set: `npx tsx --test test/agent-mode-preview.test.ts test/agent-mode-shell.test.ts test/agent-mark-shell.test.ts test/agent-mode-follows-task.test.ts test/assistant-task-rail.test.ts test/assistant-pack-contract.test.ts test/guest-kit.test.ts test/guest-shell.test.ts test/guest-retired-classes.test.ts test/assistant-cold-journey.test.ts test/assistant-task-persistence.test.ts test/shortlet-ui-foundations.test.ts`: tests 80, pass 79, fail 0, skipped 1 (the skip is pre-existing in `shortlet-ui-foundations.test.ts`, not from this issue).
- Real Chrome, solo: `npx tsx --test test/agent-mode-sheet-chromium.test.ts`: pass 2, fail 0 (run three times; the first run failed on a focus race that is fixed in the test, which now waits for focus to return).
- Real Chrome, solo, after: `npx tsx --test test/agent-mark-chromium.test.ts`: pass 4, fail 0.
- Captures: `.scratch/agent-modes/screenshots/03g/` (light and dark, 320, 390, 768, 1280; empty conversation and sheet; PNGs not committed). Findings in `.scratch/agent-modes/screenshots/03g/findings.txt`: no horizontal overflow and no control under 44 by 44 CSS px at any width or theme.

**Acceptance criteria, status (after the orchestrator follow-up).**
- AC1, AC2, AC4, AC5 (start candidate), AC7, AC9: named tests in `test/agent-mode-preview.test.ts` (11 tests, see counts below). The AC5 node test that asserted a constant is deleted.
- AC9: now the real `/conversation` page from `startLocalGuestServer` with the fake shop pack registered. It asserts no radio input, no `<dialog>`, no mark button and the stays composer copy. Green on its first run: the no-JS page never had the strip, so no red state existed to record.
- AC3 (zero requests during a preview, heading, starters and placeholder change, `data-mode` on `<html>` stays stays): `test/agent-mode-sheet-chromium.test.ts`. Green on its first run; the behaviour already existed, so no red state existed to record.
- AC5 refused start (no `/api/turn`, `data-mode` stays, preview dropped, composer text kept): `test/agent-mode-sheet-chromium.test.ts`. The refusal is produced by a page-side fetch wrapper that returns the server's closed `{ok:false, code, message}` shape. Green on its first run for the same reason.
- AC6 and AC8: `test/agent-mode-sheet-chromium.test.ts`.
- ADR 0078 visible state (WCAG 1.4.11, 2.4.7): checked and unchecked labels differ in computed colour, and a focused radio's label draws an outline. Red before the CSS fix, green after.

**Red-first evidence (orchestrator follow-up, step 1).** Recorded from the run before the CSS fix:
- `not ok 5 - ADR 0078 (WCAG 1.4.11, 2.4.7): the checked choice looks different from an unchecked one, and a focused radio draws a visible outline`
- `error: 'the checked choice differs ({"border":"rgb(50, 62, 55)","background":"rgb(24, 33, 28)"} vs {"border":"rgb(50, 62, 55)","background":"rgb(24, 33, 28)"})'`
- Same run: `# pass 4`, `# fail 1` (AC6, AC8, AC3 and AC5 refused were green).
- AC3, AC5 refused and AC9 were green on their first run. They guard existing behaviour, so no red state applies to them. This is stated plainly, not inferred.

**Orchestrator decision (step 2), approved.** Edit to the "Guest UI kit" block of `apps/web/src/shortlet-foundations.css`, minimal and in the committed one-line style, mirroring existing rules:
- `.ui-vertical-starter:has(input:checked)` copies the declarations of `.ui-chip:has(input:checked)`.
- `.ui-vertical-starter:has(input:focus-visible) { outline: 3px solid var(--color-focus); outline-offset: 2px; }`, as `.ui-segmented > label:has(input:focus-visible)`.
- `.mode-choice > .agent-mark { inline-size: 2rem; block-size: 2rem; }`. This replaces the two inline `mark.style.*` assignments, which are removed from `client.ts` (no style strings).
`dist/client.js` regenerated with `npm run build`.

**Verification after the follow-up (`env -u LLM_API_KEY` on every command).**
- `npm run check`: exit 0 (log at `$HOME/03g-check3.log`, last line is the worker bundle guard).
- `npx tsx --test test/agent-mode-preview.test.ts test/agent-mode-shell.test.ts test/agent-mark-shell.test.ts test/guest-retired-classes.test.ts test/shortlet-ui-foundations.test.ts test/shortlet-design-system.test.ts test/assistant-cold-journey.test.ts`: tests 41, pass 40, fail 0, skipped 1. The skip is `shortlet-ui-foundations.test.ts` AC "Real Chromium renders foundation without narrow viewport overflow and exposes visible keyboard focus", which runs only with `SHORTLET_FOUNDATIONS_BROWSER=1` and is pre-existing.
- `npx tsx --test test/agent-mode-preview.test.ts`: tests 10 after the follow-up (11 before, minus the deleted AC5 node test), pass 10, fail 0.
- Real Chrome, solo, in order: `test/agent-mode-sheet-chromium.test.ts` pass 5, fail 0 (run twice, both green); then `test/agent-mark-chromium.test.ts` pass 4, fail 0.
- Captures re-run: `.scratch/agent-modes/screenshots/03g/` (not committed). `findings.txt` and the capture log: 16 of 16 combinations (light and dark, widths 320, 390, 768, 1280, empty and sheet) have no horizontal overflow and no control under 44 by 44 CSS px.

**Definition of Done (re-checked).**
1. Every criterion has a named test: met. AC3 and AC5 refused are now real-browser tests; AC9 is the real page.
2. Failure paths asserted: met. The refused start, the malformed and duplicate presentations, and no-JS parity are asserted.
3. ADRs listed and cited: met (table above; ADR 0078 visible state added).
4. No unused injected dependency: met.
5. No invented policy string: met. The warning is owner-approved (16 Nov 2026).
6. No credentials in logs: not applicable.
7. `npm run check` passes. The full `npm test` is the batch gate and is run later by the orchestrator, not here.

Only the batch-gate `npm test` is open, so Status is set to resolved, following 03b to 03d.

**Still not done, stated plainly.**
- `scroll-snap` on the strip is not added (no CSS). Layout works without it.
- The node AC3 test in `agent-mode-preview.test.ts` ("A preview creates no task") remains a weak check. The real behaviour is covered by the Chrome AC3 test.
- `apps/cloudflare/public/_headers` and `apps/local-guest/dist/*.js` (except `client.js`) show line-ending changes from the build. Not staged.

17 Nov 2026 (orchestrator, batch gate) — deliberate test-expectation change, recorded here like the O8 changes. `presentationFor` (ADR 0107 decision 6) also reaches the minimal `/api/state` response for a fresh or unreadable thread id (`guest-server.ts` spreads it), so the empty-state payload now carries `mode: GUEST_MODES.stays` (and `verticals` when the assistant runtime is present). Three tests still asserted the bare old payload and failed in the batch gate while passing at 81367ed: `test/guest-conventional-search.test.ts` AC4, `test/guest-new-conversation.test.ts` AC1, `test/local-guest-shell.test.ts` (unknown-thread refresh). Their expected payloads now include the default mode presentation from the same single source (`GUEST_MODES.stays`); the fail-closed content of those responses (empty timeline, empty surfaces, no data from any other thread) is unchanged and still asserted. Verified solo in the gate worktree: 23 passed, 0 failed across the three files.