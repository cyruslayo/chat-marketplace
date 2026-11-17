# Announce a mode switch through the existing polite announcer

Status: resolved
Type: task
Blocked by: 03c (resolved: the client applies the server's mode and can tell when it changes). It also serves 03f (the tier C suggestion changes the mode only after a confirmation) and 03g (the strip commits a preview). Owner release before any build (ADR 0107 "Settled", 8 Nov 2026).
Requested: 16 Nov 2026

## Open owner decisions

1. **Wording.** No copy exists for a switch. ADR 0107 decision 7 requires the change to be announced and names the persona, but gives no words. Owner to write the copy. The copy lives only in `apps/web-agent/src/guest-content.ts` (ADR 0077).
2. **Where the copy lives.** (a) A new field on `ModePresentation`, which changes the presentation contract, its validator and the stays presentation; or (b) one template in `guest-content.ts` that takes the persona name. Recommendation: (b), so the pack contract does not change.
3. **Previews.** A preview in the 03g strip creates no switch (ADR 0107 decision 9). Recommendation: a preview is not announced. Only a committed switch is.
4. **Suggestions.** A tier C suggestion (03f) is announced only when the guest accepts it, as a switch. Owner to confirm.
5. **Same response.** A response can carry a reply and a switch. Owner to choose the order, or one combined message, so the guest hears each once.

## Parent

[Agent modes architecture analysis](../architecture-analysis.md), section 5.5 (the switch moment: announcement); [ADR 0107](../../../docs/adr/0107-present-each-domain-pack-as-an-agent-mode.md) decision 7 (a switch is announced through the existing polite announcer; the persona name says which agent is active, so the switch never relies on colour alone); [ADR 0078](../../../docs/adr/0078-meet-an-accessible-nigerian-launch-profile.md) (dynamic surfaces announce meaningful changes, not tokens). Map slice `4-announce`.

## Why

Facts from the survey:

- `announce(text, assertive)` writes to `#announcer` (polite) or `#error-announcer` (assertive) (`apps/local-guest/src/client.ts:1657` to `:1660`). `#announcer` is `role="status"`, `aria-live="polite"` (`apps/local-guest/src/guest-server.ts:615`).
- A mode change is silent today. `applyResponseMode` (`client.ts:1550` to `:1554`) sets `data-mode` and nothing else. A guest using a screen reader gets no word when the agent changes.
- The mode-specific copy already comes from the presentation. The client reads `appliedMode.workspace.returnedAnnouncement` and `readyAnnouncement` (`client.ts:1997` and `:2003`), and the stays copy is in `apps/web-agent/src/guest-content.ts` (`STAYS_PRESENTATION`, around `:886` to `:890`).
- Other client announcements are literals in `client.ts`, for example "Message sent. The concierge is working on your request." (`client.ts:2780`). The switch copy must not be added the same way (ADR 0077).

## What to build

1. **Copy.** One switch copy, sourced from `guest-content.ts` and bounded by the presentation limits (`MODE_TEXT_MAX_LENGTH`, 400 characters), as decided by owner decision 2.
2. **Trigger.** In `applyResponseMode`, when the response's mode id differs from the id last applied, announce the copy once through `announce(text)` with `assertive` false.
3. **First response.** The first response after a page load announces nothing, because no switch happened. A reload restores a mode without a switch.
4. **Malformed mode.** A response whose mode fails validation is refused by the existing check and announces nothing.
5. **Preview and suggestion.** Per owner decisions 3 and 4 (default: a preview is not announced).
6. **Order.** Per owner decision 5.
7. **No literal in the client.** The copy is not written in `client.ts`.

## ADRs to read first

| ADR | Constraint | Where it lands |
| --- | --- | --- |
| 0107 decision 7 | The change is announced through the existing polite announcer; the persona name says which agent is active. | Steps 1 and 2; AC 1 and 4. |
| 0078 | Dynamic changes announce meaningful changes, not tokens or ids. | Steps 1 and 2; AC 5. |
| 0077 | One copy source: `guest-content.ts`. | Steps 1 and 7; AC 5. |
| 0080 | No-JS parity. A no-JS page reloads for each turn, so it has no in-place switch to announce. | Scope note; no AC. |
| 0107 decision 9 | A preview creates no switch. | Owner decision 3; AC 7. |

## Acceptance criteria

Each is its own `test()` in `test/agent-mode-announcement.test.ts` (new).

1. A response that changes the mode announces the switch copy once through the polite announcer.
2. A response with the same mode id announces nothing.
3. The first response after a page load announces nothing.
4. The switch announcement uses the polite announcer; the assertive announcer stays empty.
5. The switch copy comes from `guest-content.ts`, and a grep test finds no literal copy for it in `client.ts`.
6. A response with a malformed mode is refused and announces nothing (fail closed).
7. A preview in the strip announces nothing (owner decision 3).
8. A response that carries both a reply and a switch announces each once, in the order chosen in owner decision 5.

## Verification

- `env -u LLM_API_KEY npm run check`.
- Local: `env -u LLM_API_KEY npx tsx --test test/agent-mode-announcement.test.ts test/agent-mode-follows-task.test.ts test/guest-focus-announcements.test.ts`. Before running, confirm `test/guest-focus-announcements.test.ts` still passes unchanged, because it asserts the existing announcer copy.
- Real Chrome: not required; the announcer is text content. A manual check with a screen reader on the reference low-end Android Chrome is recorded under `## Comments`.
- Record the exact commands and pass counts under `## Comments`.

## Out of scope

- The wording itself (owner decision 1).
- The strip (03g) and the tier C suggestion copy (03f).
- A new announcer element.
- The View Transition (03j) and the theme colour (03k).

## Comments

### 17 Nov 2026: built (agent)

Owner decisions applied:

- 1+2. Wording is `You’re now talking to {persona}.`, one template `guestModeSwitchAnnouncement(personaName)` in `apps/web-agent/src/guest-content.ts`. The persona is `GUEST_MODE_CHOOSER.conciergeLabel(mode.label)` (for stays, "Concierge · Stays"). `ModePresentation` and its validator are unchanged.
- 3. A strip preview announces nothing: `previewChoose` and `renderModeStrip` make no response and call neither `announce` nor `applyResponseMode` (AC7).
- 4. A tier C suggestion announces only when accepted, through the same response path (the server response carries the new mode). No special case.
- 5. One response with a reply and a switch: the held switch copy is the first text in one polite write (switch copy, a space, then the reply text). If a response has no polite text, the switch is written alone by `flushModeSwitchAnnouncement()`. A reply delivered as chat messages is announced by the transcript (`#transcript`, role log), not by `#announcer`, so the switch is written alone there and the guest hears each once. Owner to confirm this reading.

Implementation: pure helper `apps/local-guest/src/mode-announcement.ts` (`createModeAnnouncements`). The first response after load is never a switch (the restore and the first state read are baseline). A malformed mode is refused by `readResponseMode` and changes nothing. `announce()` routes polite text through the helper and writes assertive text straight to `#error-announcer`. `client.ts` holds no switch copy.

ADRs read and applied: 0107 (decisions 2, 6, 7, 9), 0077 (one copy source in guest-content.ts), 0078 (announce meaningful changes, not tokens; the switch copy names the persona), 0080 (the no-JS page reloads per turn, so there is no in-place switch to announce; untouched).

Deviation: Definition of Done item 7 names `npm test`. Per the owner's instruction for this batch, the full `npm test` and `npm run test:workers` run once at the pre-merge gate, not per issue.

Commands and pass counts (all prefixed `env -u LLM_API_KEY`):

- Before changes: `npx tsx --test test/guest-focus-announcements.test.ts`: 3/3 pass.
- New test, red first (module not found), then green: `npx tsx --test test/agent-mode-announcement.test.ts`: 8/8 pass (AC1 to AC8, one `test()` each).
- `npm run check`: exit 0 (tsc for the root, apps/cloudflare, the test and tooling configs, and the worker bundle guard).
- `npx tsx --test test/agent-mode-announcement.test.ts test/agent-mode-follows-task.test.ts test/guest-focus-announcements.test.ts test/agent-mode-theme-color.test.ts test/agent-mode-shell.test.ts`: 42/42 pass.
- Related node tests (agent-mark-shell, agent-mode-preview, mode-suggestion-tier-c, guest-internal-terms, guest-copy-pass, guest-presentation-contract, local-guest-shell, guest-refusal-copy, guest-retired-classes, guest-surface-hooks, guest-new-conversation, guest-turn-cancel, guest-long-conversation, guest-chip-continuity, guest-changed-elsewhere, guest-amount-labels, guest-date-format, extended-stay-counsel-copy, assistant-pack-contract, assistant-task-lanes): 112/112 pass, one command.
- `npx tsx --test test/agent-mode-sheet-chromium.test.ts` (solo): 5/5 pass. Then `npx tsx --test test/agent-mode-theme-color-chromium.test.ts` (solo, after the first finished): 2/2 pass.
- `npm run build`: regenerated `apps/local-guest/dist/client.js`. Restored `dist/gallery.js`, `dist/landing.js`, `dist/offer.js`, `dist/payment.js` and `apps/cloudflare/public/_headers` with `git checkout --`; only `client.js` is committed from dist.

Owner check (not an agent gate): a manual screen-reader check on the reference low-end Android Chrome, confirming the switch is heard once and the reply is not repeated.
