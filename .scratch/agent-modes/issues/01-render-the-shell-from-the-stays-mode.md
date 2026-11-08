# Render the guest shell from the stays Agent Mode, with no visible change

Status: ready-for-agent
Type: task
Blocked by: none (ADR 0107 accepted 8 Nov 2026)
Requested: 8 Nov 2026

## Parent

[Agent modes architecture analysis](../architecture-analysis.md), slice 1. ADR 0107 (accepted).

## Why

The chat shell and the no-JS `/conversation` page hard-code stays copy, so a second Domain Pack cannot change what the guest sees without editing the shell (ADR 0107, Context).

- `apps/local-guest/src/guest-server.ts:577-612` (`renderGuestShellHtml`, which takes no arguments) writes all of these into the markup:
  - the empty-state heading "Find a place to stay" and its body
  - the starters "Explore Abuja" and "Explore Lagos" (`data-prompt`)
  - the composer `aria-label` "Message the concierge", label "Your message", placeholder "Area, dates, guests" and hint
  - the region labels "Current stay details" and "Your search", and the button "Return to your current stay details"
- `guest-server.ts:774` (the no-JS `/conversation` page) repeats the composer label, `aria-label` and hint.
- `apps/local-guest/src/client.ts:1881`, `:1887` and `:2599` hard-code "Your stay details are still here" and "Your stay details will stay here".
- `<html>` carries `data-theme="system"` (`guest-server.ts:330`) but no `data-mode`.
- No guest response tells the client which mode is active. `GuestTurnSuccess` and the state read (`apps/local-guest/src/shortlet-app.ts:360-400`) and the client's response type (`client.ts:145-152`) have `criteria`, `tasks` and `verticals`, but no `mode`.

This slice moves that copy into one stays presentation and renders the shell from it. **The guest sees no change.** Switching modes, the persona change and the generic pack contract are later slices.

## What to build

1. **Presentation type and stays copy.** In `apps/web-agent/src/guest-content.ts`, add a `ModePresentation` type and a frozen `GUEST_MODES.stays`. Its fields are listed in `architecture-analysis.md` section 5.2. Also add `workspace.returnedAnnouncement`, `workspace.readyAnnouncement` and `workspace.workingStatus` for the three `client.ts` strings. Every string is the **exact current text**, moved and not reworded. No new copy may be invented (Definition of Done item 5).
2. **Validation.** Add `validateModePresentation(value: unknown): ModePresentation | undefined` (fail closed). It accepts known keys only, non-empty strings within a bound, a kit icon name, and 1–4 starters. Put it beside the type, or in `guest-kit.ts` if that is where shared shell guards live. Use `unknown` and narrowing; no `any`.
3. **Kit helpers.** In `apps/local-guest/src/guest-kit.ts`, add `emptyStateHtml(mode)` and `composerHtml(mode, variant: "chat" | "page")`. They render the same element ids, classes and attributes the shell uses today (`#empty-state`, `.prompt-suggestion[data-prompt]`, `#composer`, `#composer-input`, `#composer-hint`). The chat shell and `/conversation` both call them (ADR 0077, ADR 0080).
4. **Shell.** `renderGuestShellHtml(mode: ModePresentation = GUEST_MODES.stays)` renders from the presentation, including the workspace and criteria labels, and sets `data-mode="${mode.id}"` on `<html>`. The no-JS conversation page takes the same presentation for its composer. Hosts (`guest-server.ts:3729`, the Cloudflare and pilot entries that call into it) pass nothing new and get stays.
5. **Responses carry the mode.** Add `mode?: ModePresentation` to `GuestTurnSuccess` and the state read. Set it to the default presentation on the assistant path and the non-assistant path alike, including on the assistant `getState` after a cold restore. The source is the composition root's default mode, which is stays for every host today. This slice does not read `activeTaskId`: with one pack it is always stays.
6. **Client.** Extend the response type and its validator (next to `isGuestVertical`) with `mode`. An invalid `mode` is rejected the way invalid `verticals` are. Replace the three hard-coded announcements with the copy from the last-applied presentation, falling back to `GUEST_MODES.stays` before the first response. **Do not** add view transitions, mode switching or token blocks here. Regenerate `apps/local-guest/dist/client.js` and commit only that file from `dist/`.
7. **CSS.** No change in this slice. The `--mode-*` token blocks arrive with switching (slice 4).
8. **Glossary.** Add **Agent Mode** to `packages/platform-core/CONTEXT.md` using the text in `architecture-analysis.md` section 10.

## ADRs to read first

ADR 0107 (this effort), 0099 (packs declare, platform renders), 0077 (one copy source), 0080 and 0081 (no-JS parity), 0078 (accessible profile), 0106 (cold restore: the mode must come back on assistant responses and after a restore), 0104 (no commerce work: do not touch `GUEST_VERTICALS.shopDescription` or the commerce pack). Also read the AGENTS.md sections "Guest UI kit" and "Concierge assistant path".

## Acceptance criteria

Each criterion gets its own `test()`, named after it.

1. **The stays presentation holds the current shell copy unchanged.** `GUEST_MODES.stays` equals the strings currently at `guest-server.ts:577-612`, `:774` and `client.ts:1881/1887/2599`. The test pins them literally.
2. **A malformed presentation is refused.** `validateModePresentation` returns `undefined` in each of these cases: an unknown key, a missing `id`, an empty heading, 0 or 5 starters, an over-long string, an unknown icon, and a non-object.
3. **The chat shell is rendered from the presentation.** With a test presentation (different strings, test-only), `renderGuestShellHtml(test)` shows the test heading, starters, placeholder, hint and region labels, and none of the stays strings.
4. **The default shell is unchanged.** `renderGuestShellHtml()` output equals the pre-change output apart from `data-mode="stays"` on `<html>`. Use a stored snapshot taken before the change, or the existing `local-guest-shell.test.ts` assertions plus the new attribute. `test/local-guest-shell.test.ts`, `guest-app-frame`, `guest-copy-pass`, `guest-new-conversation` and `guest-retired-classes` pass without edits to their assertions.
5. **The no-JS conversation page uses the same composer copy.** `/conversation` renders its composer label, `aria-label` and hint from the same presentation as the chat shell, through `composerHtml`.
6. **Every guest response carries the mode.** A turn, an event and a state read return `mode.id === "stays"` on the non-assistant path.
7. **The mode survives a cold restore on the assistant path.** On the `assistant-cold-journey` harness (assistant enabled, a new `LocalGuestApp` over the same store before every event, clock 2026-10-27, guest with no seeded phone or email), each response from search through payment handoff carries `mode.id === "stays"`.
8. **The client refuses an invalid mode.** A response whose `mode` fails validation is treated as an invalid response, as invalid `verticals` are today.

## Verification

- `npm run check`.
- `npx tsx --test` on the new test file, plus `test/local-guest-shell.test.ts`, `test/guest-app-frame.test.ts`, `test/guest-copy-pass.test.ts`, `test/guest-new-conversation.test.ts`, `test/guest-retired-classes.test.ts` and `test/assistant-cold-journey.test.ts`.
- Real Chrome, one at a time: `test/mobile-guest-journey-chromium.test.ts` (AC31 checks the shell landmarks and prompt controls) and `test/guest-task-rail-chromium.test.ts` (it renders the shell).
- UI evidence: run `capture-11-all.sh` and compare with `screenshots/final/`. There must be no visual diff at 320, 390, 768 or 1280, light or dark. Save to `.scratch/agent-modes/screenshots/01/`.
- Record the commands and pass counts under `## Comments`.

## Out of scope

- Mode switching, view transitions, `--mode-*` tokens, `theme-color`, and the mode switcher (slices 4 and 5).
- The persona and preamble change (slice 2), and the generic pack contract (slice 3).
- Adding an empty state or starters to the no-JS page. That would be a visible change: raise it as a follow-up if parity calls for it.
- Any commerce change.

## Comments
