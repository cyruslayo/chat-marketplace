# Show the Agent Mark for the single stays mode

Status: ready-for-agent
Type: task
Blocked by: 01 (needs `ModePresentation`, `data-mode` and the shell helpers)
Requested: 8 Nov 2026

## Parent

[Agent modes architecture analysis](../architecture-analysis.md), sections 9.1 and 9.2, slice 1b. ADR 0107 decision 9. The playground (`.scratch/agent-modes/playground/agent-mode-playground.html`) shows the intended feel; it is a reference, not code to copy.

## Why

With one mode registered, the guest still benefits from a visible agent identity and a clear "the concierge is working" signal. Today the only signal is `#working-status` text. This slice adds the mark and the presence dock for stays alone: no switching, no strip, no sheet.

## Decisions this issue relies on (owner, 8 Nov 2026)

- One concierge with domain capabilities: the label is "Concierge · Stays" (see issue 02). Persona copy lives in `GUEST_MODES.stays.persona` in `apps/web-agent/src/guest-content.ts`. Before adding it, check that "Concierge" plus the mode label is the only new guest copy; anything more needs owner wording (Definition of Done item 5).

## What to build

1. **Glyph.** Add the stays mark to the kit icon set (`apps/web/src/ui-kit.ts`, `icon()`), a single inline SVG with a stays silhouette (a roof-like arc), `currentColor`, `aria-hidden="true"`. Its name goes in `ModePresentation.persona.icon`, and `validateModePresentation` accepts it.
2. **Placements.** A hero mark (about 72px) above the empty-state heading and an app-bar mark (about 28px) before the title in `.ui-appbar` (`guest-server.ts:557`), both rendered by a `guest-kit.ts` helper `agentMarkHtml(mode, placement)`. Both share `view-transition-name: agent-mark`, so the first message moves the hero mark into the app bar (same-document view transition, feature-detected, skipped under reduced motion). The app-bar mark is **not** a button with one mode (analysis 9.3, "One mode registered").
3. **States.** The client sets `data-agent-state` on the marks from existing signals only:
   - `idle`: nothing in flight.
   - `listening`: composer focused with text.
   - `thinking`: a turn or event in flight (`isLoading`, `client.ts:1513`, `:2594`).
   - `working`: an assistant tool step is running, if the response or progress signal already says so. If there is no such signal today, do not invent one: map it to `thinking` and say so in Comments.
   - `responding`: a reply arrived (one short pop, then `idle`).
   - `resting`: `quota_refusal` or `CONCIERGE_UNAVAILABLE`.
   - `suggesting` and `switching` are defined in the CSS and type but unused until 4b.
   - `human`: see "Human state" below.
4. **Presence dock.** A small strip above the composer that shows the mark and a step chip while a turn is in flight, and drops away when the reply lands. The chip text reuses existing working-status copy; `#working-status` stays the accessible signal. No new announcer.
5. **Motion rules (ADR 0107 decision 9, WCAG 2.2.2, ADR 0078).**
   - `transform` and `opacity` only, `linear()` spring easing, written inside `@media (prefers-reduced-motion: no-preference)`. Every state has a static form. No global duration hack.
   - Nothing loops longer than 5 seconds: `thinking` settles into its still form after 5 s even if the turn is still running.
   - All mark animation pauses while the page is hidden.
   - No flashing above three per second. No Lottie, dotLottie, Rive or any animation library.
6. **Colour.** The mark reads `currentColor` and existing semantic tokens. Do not add `--mode-*` token blocks (slice 4). No hex, no page-level `style:` strings.
7. **Accessibility.** The mark is `aria-hidden` decoration. The app-bar title carries the text label. No new focus stop. Targets near it keep 44px.

## Human state

ADR 0076 requires that the mark never shows AI activity during a human takeover. **No takeover signal reaches the guest app today** (no match for takeover in `apps/local-guest/src`). So:

- Define the `human` state in the type and CSS (a person badge, no motion), with a unit test that a mark in `human` has no running animation.
- Do not wire it to anything. Add a code comment at the state map citing ADR 0076: any future takeover signal on guest responses must set `human` and block `thinking`, `working` and `responding`.
- Note in Comments that wiring is owed to whichever issue brings takeover to guests.

## ADRs to read first

ADR 0107 (decision 9), 0076 (human takeover), 0078 (accessible profile, 44px, motion), 0077 (one copy source), 0080 and 0081 (no-JS: the server-rendered marks show in the `idle` static form and the page works without the client), 0106 (the shell state must survive a cold restore: the mark state is derived on the client from the current request, never persisted). Also read AGENTS.md "Guest UI kit" and run the modern-web-guidance search for `motion`, `icons` and `same-document-transitions` before writing CSS.

## Acceptance criteria

Each gets its own `test()`, named after it.

1. **The shell shows the stays mark in both placements.** The rendered shell has a hero mark in the empty state and an app-bar mark, both `aria-hidden`, both from `agentMarkHtml`, and the app-bar mark is not a button.
2. **Each state comes from an existing signal.** Unit test of the client state map: in-flight gives `thinking`, a reply gives `responding` then `idle`, `quota_refusal` and `CONCIERGE_UNAVAILABLE` give `resting`, a focused composer with text gives `listening`.
3. **Reduced motion has no animation.** In real Chrome with `prefers-reduced-motion: reduce`, no mark or dock element has a running animation in any state.
4. **Nothing loops past 5 seconds.** In real Chrome, with a turn held in flight for 7 s, the `thinking` mark has no running animation after 5 s and `#working-status` still reports the turn.
5. **Animation pauses while hidden.** When the document is hidden, mark animations are paused.
6. **The human state never animates.** A mark set to `human` shows the person badge and has no running animation.
7. **The dock drops away when the reply lands.** The presence dock is visible while a turn is in flight and hidden after the response, and the conversation landmarks are unchanged.
8. **No-JS shows the static mark.** The server-rendered shell shows the marks in their static `idle` form with no client script.

## Verification

- `npm run check`.
- `npx tsx --test` on the new test files plus `test/local-guest-shell.test.ts`, `test/guest-app-frame.test.ts`, `test/guest-retired-classes.test.ts` and `test/assistant-cold-journey.test.ts`.
- Real Chrome, one at a time: the new real-Chrome file, then `test/mobile-guest-journey-chromium.test.ts`.
- UI evidence: captures at 320, 390, 768 and 1280, light and dark, of the empty state, an in-flight turn and a reply, plus the horizontal-overflow and 44px checks, into `.scratch/agent-modes/screenshots/01b/`. Re-run `capture-11-all.sh` because the shell changes.
- Record commands and pass counts under `## Comments`.

## Out of scope

- The mode strip, the app-bar sheet and any mode switching (4, 4b, 5).
- `--mode-*` tokens and `theme-color` (4).
- Wiring the `human` state to a takeover signal (see above).
- Haptics. Any commerce change.

## Comments
