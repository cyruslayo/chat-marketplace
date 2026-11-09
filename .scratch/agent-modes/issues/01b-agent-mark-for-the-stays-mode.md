# Show the Agent Mark for the single stays mode

Status: ready-for-human
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

### Agent D, UI evidence and docs (issue 01b, head 9b399ef)

Status at this entry: **ready-for-human**. Code is complete and the evidence is captured, but the issue is not resolved: DoD item 7 is not satisfied (see the DoD audit), and the owner has open decisions (items k and l below). The dock placement beside an open workspace is settled by the owner (item e). Nothing was pushed, merged or deployed. No product code was changed by this entry.

**Commands and counts (this run, worktree `C:\AI2026\chat-marketplace-agent-modes-01b`):**

- `env -u LLM_API_KEY npm run check`: exit 0 (root tsc, apps/cloudflare, test and tooling configs, worker bundle guard).
- `env -u LLM_API_KEY npx tsx --test test/agent-mark-shell.test.ts test/agent-mode-shell.test.ts test/local-guest-shell.test.ts test/guest-app-frame.test.ts test/guest-copy-pass.test.ts test/guest-new-conversation.test.ts test/guest-retired-classes.test.ts test/assistant-cold-journey.test.ts test/shortlet-design-system.test.ts`: **53 pass, 0 fail, 0 cancelled, 0 skipped** (41.3 s). The "86/86" offline set in the brief is a different file list that I could not reconstruct, so I did not reproduce 86/86.
- `env -u LLM_API_KEY npx tsx --test test/agent-mark-chromium.test.ts` (real Chrome, one file): **4 pass, 0 fail** (AC3, AC4, AC5, AC7; 33.9 s).
- `env -u LLM_API_KEY npx tsx --test test/mobile-guest-journey-chromium.test.ts` (real Chrome, one file): **42 pass, 1 fail, 43 total**, 629.5 s. The failure is AC28 ("Provider/network failure retains the current authoritative workspace"): a text wait for "temporarily unavailable" that timed out (the test ran 16.3 s). AC28 solo (`--test-name-pattern "AC28"`): **1 pass**. Classified as a load flake (the same file is on the AGENTS.md list), but not reproduced in the full run, so it is not proven. The brief's 43/43 in 332 s was not reproduced in this run.
- Captures (each a separate process, run one after another): `env -u LLM_API_KEY npx tsx .scratch/agent-modes/capture-01b.ts empty|flight|reply|split`.
- Full sweep: `env -u LLM_API_KEY sh .scratch/guest-ui-consistency/capture-11-all.sh` on the head (FINISHED, exit 0), on the pre-01b base 5c1a6a7 (exit 0), and on the base a second time to measure run-to-run noise (exit 0). Head findings: no horizontal overflow; the only controls under 44px are the hidden native `INPUT 1x1` radios on payment-choice (the same as before the change, per AGENTS.md).

**Evidence:** `.scratch/agent-modes/screenshots/01b/`

- `empty-*`, `flight-*`, `reply-*`, `split-*` (light and dark, 320, 390, 768, 1280), each with `findings-*.txt`. The findings record every mark's placement, state, `aria-hidden`, focusability, size and running animations, plus the dock's geometry and overlaps.
- `sweep-head/` (the head sweep, 285 files, with findings) and `sweep-pre-01b/` (the base sweep, 285 files).
- `compare/`: `classify-01b.tsv` (one row per screen: identical, changed, unstable base, noise), the three pixel-compare reports, and the side-by-side pairs cited below.
- Scripts: `.scratch/agent-modes/capture-01b.ts` (capture), `.scratch/agent-modes/compare-01b.mjs` (pixel compare), `.scratch/agent-modes/classify-01b.mjs` (classification and diff boxes).

**What each capture shows:**

- **Empty state (hero mark):** the 72px hero mark sits above the heading and the 28px app-bar mark is in the header, both idle, `aria-hidden`, not focusable, with no running animation. No overflow and no control under 44px at any width or theme.
- **In flight (dock and thinking mark):** the dock shows above the composer with the 24px dock mark and the working copy. The app-bar mark is `thinking`. The hero mark is `thinking` but has zero width, since the empty state is hidden. The shot was taken 5.5 s after the turn started, so the thinking loop has settled into its still form.
- **Reply:** a MutationObserver recorded the app-bar mark's states across a real submit: `idle -> listening -> thinking -> responding -> idle`. The shot is the settled idle form. ("listening" is the composer focused with text, before submit.)
- **Desktop split (1280, workspace open):** the dock is `display: none` and overlaps neither the workspace nor the composer. It is also hidden at 320, 390 and 768 with a workspace open (item k).

**Head against pre-01b base (`classify-01b.tsv`):** 264 PNG pairs. 154 identical. 49 screens are stable across two base runs and differ from the head: 48 are the app-bar mark (diff box at y21-41 on desktop, x16-130 at mobile) plus, on chat-home, the hero mark and the content it pushes down (diff boxes to y333 at 1280 and y426 at 320); the other one (no-reservation-page-light-320) is covered below. 54 screens are unstable in the base itself (two base runs disagree), and 7 are base-unstable with the head matching one run. The unstable and noisy screens are the standalone pages (bank-transfer, manual-transfer, manual-waiting, confirmed, about 600 pixels each), where the booking reference and similar generated text differ per run (for example `res_cmd-57eb...` against `res_cmd-28e9...`), and the chat-shell screens whose base already varies by thousands of pixels (chat-unit, chat-results at 320 and 390). None of those diffs is outside the header band or the marks. `no-reservation-page-light-320`: the first head sweep showed the two footer buttons faded. A re-run of the group on the head matched the base byte for byte. I treat it as a capture flake, not a change.

**Pre-existing, not introduced by this change:** the send button shows "Working..." overflowing its 44px circle at 320 and 390 while a turn is in flight. The pre-01b base shows the same overflow (`pre-01b-flight-light-390.png` against the head in `compare/pair-flight-pre-01b-vs-head-390.png`). It belongs to a separate fix.

**Definition of Done (docs/agents/issue-tracker.md), item by item:**

1. **Every AC has a dedicated named test: MET.** AC1 `AC1: The shell shows the stays mark in the hero and in the app bar`; AC2 `AC2: Each mark state comes from an existing signal` and `AC2: No event sequence yields human, working, suggesting or switching`; AC3, AC4, AC5 and AC7 in `test/agent-mark-chromium.test.ts`; AC6 `AC6: A mark in the human state shows the person badge and never animates`; AC8 `AC8: The server-rendered shell shows both marks in the idle state without a client script`.
2. **Failure paths exercised: MET under the criteria as worded.** AC2 covers the refusal path (both `quota_refusal` and `CONCIERGE_UNAVAILABLE` give `resting`), and the second AC2 test covers the states that must not occur (`human`, `working`, `suggesting`, `switching`). AC6 asserts the negative (no animation). AC1, AC3, AC4, AC5, AC7 and AC8 are positive checks as their criteria are worded.
3. **Every ADR touching the domain listed and read: MET (9 Nov 2026 pass).** All seven ADRs in the issue's list are now read in full: 0107 (all decisions and amendments), 0076, 0077, 0078, 0080, 0081 and 0106 (including its amendments). The ADR table below cites the constraint each change relies on. No change violates a constraint; the known deviations are in the table and in (a) to (l).
4. **No unused injected dependency: MET by inspection.** `agentMarkHtml(mode, placement, state)` uses all three parameters. `nextAgentMarkState` is called from `setAgentMark`, and every event type it accepts is produced (`turn-started` and `turn-ended` from `setLoading` and `sendEvent`, `reply-landed` and `response-settled` from `landAgentReply`, `turn-refused` from `renderResponse`, `composer-changed` from the composer listeners). `AGENT_MARK_POP_MS` is used.
5. **No invented policy string or rule: MET, with notes.** The diff of `guest-content.ts` changes only the stays persona icon. The dock chip reuses `workspace.workingStatus`. No new copy was added, so "Concierge · Stays" is still owed to issue 02. The motion values (CSS durations of 320 to 1200 ms, the `linear()` spring, `AGENT_MARK_POP_MS = 400`) are engineering values, not domain policy. The 5-second cap comes from ADR 0107 decision 9 and WCAG 2.2.2.
6. **No credential or identity material in logs: MET.** The diff of `apps/` and `test/` adds no logging.
7. **`npm run check` and `npm test` pass: NOT MET (test run pending).** `npm run check` passes (exit 0). `npm test` is the pre-merge batch gate (CLAUDE.md, Test scope) and has not been run for this issue. The real-Chrome mobile journey has one AC28 failure in its one full run (see above), so the batch run must confirm it.

**ADR table (what each constraint requires, and where the code meets it):**

| ADR | Constraint | Code path or test |
|---|---|---|
| 0107 d9 | States are a closed set, each from an existing signal | `agent-mark-state.ts` (`nextAgentMarkState`); `client.ts` `setAgentMark` and its call sites; tests AC2 |
| 0107 d9 | Motion is `transform` and `opacity` only, inside `prefers-reduced-motion: no-preference`, with a static form per state | `shortlet-foundations.css` "Agent Mark" block; chromium AC3 |
| 0107 d9 | Nothing loops past 5 s (thinking settles after 4 x 1200 ms) | CSS `agent-mark-think` (4 iterations); chromium AC4 |
| 0107 d9 | Motion pauses while the page is hidden | `client.ts` `syncPageHidden` sets `data-page-hidden`; CSS `html[data-page-hidden]` rules; chromium AC5 |
| 0107 d9 | The mark is `aria-hidden` decoration; the text carries the status | `agentMarkHtml` in `guest-kit.ts`; the `#working-status` text is unchanged; `findings-*.txt` (focusable false, aria-hidden true) |
| 0107 d9 | Presence dock drops away when the reply lands | `#agent-dock` `hidden` set in `setLoading`; chromium AC7 |
| 0107 d9 | The dock sits above the composer while a turn is in flight | **Deviation, settled by the owner on 9 Nov 2026:** the dock stays hidden while a workspace is open. The CSS rule `main:has(#active-workspace:not([hidden])) > #agent-dock` in `shortlet-foundations.css` hides it. No grid row is added, so the shell grid template and the snapshot are unchanged. Split captures show it hidden |
| 0107 d9 | The chip names the current step in pack copy | **Deviation.** No step signal exists, so the chip reuses the working copy (item k) |
| 0107 d9 | `working` is a tool step shown by a pack prop | **Deviation.** No tool-step signal, so `working` is never produced (deviation a) |
| 0107 d9 | The mark sits inside a labelled control | **Deviation.** The app-bar mark is not a button (01b "What to build" 2, analysis 9.3). A control arrives with the mode sheet (slice 5) |
| 0107 d9 | Colour from `--mode-*` tokens | **Deferred** to slice 4. The marks use `--color-action` and `--color-text-secondary` |
| 0107 d11 and ADR 0106 | Shell state is derived from the current request and never persisted; a cold restore starts at `idle` | The state lives in a module variable; `client.ts` only reads and writes `sessionStorage` for the thread id, as before. No mark state is written to storage |
| 0076 | `human` never shows AI activity, and nothing leaves `human` | `nextAgentMarkState` keeps `human` absorbing; AC6; `agentMarkHtml` renders the person badge. **Not wired** (deviation b) |
| 0078 | 44px targets near the marks; reflow at 320; no horizontal overflow | Sweep findings and the capture findings: no control under 44px and no overflow at any width (the `INPUT 1x1` radios are hidden) |
| 0078 | Dynamic surfaces announce meaningful changes, not tokens | No new announcer. `#working-status` and the `#announcer` are unchanged |
| 0077 | Channel renders the canonical artifact; no recalculated amounts or deadlines | The marks render no amounts, deadlines or consent text. Copy is unchanged |
| 0080 | No agent-only state transition | The marks read state and write nothing; no command or route is added |
| 0081 | Weaver types stay out of domain and platform code; the A2UI and CopilotKit path is not used by the marks | No Weaver or A2UI import or reference in the 01b diff of `apps/` and `test/`. The marks use the kit icon set only |
| 0081 | Rich UI failure must not remove or corrupt authoritative state; conventional routes stay the fallback | The marks are inert decoration. They write no state and no command. The no-JS shell shows the static idle marks (AC8), so the page works without the client script |
| 0081 | Reduced motion, WCAG 2.2 AA, en-NG copy and constrained networks unchanged; human handoff requirements unchanged | Marks respect `prefers-reduced-motion` (chromium AC3). No new copy, so en-NG is unchanged. The human state is defined but not wired, the gap in deviation (b) |
| 0106 | The model never grants permissions; the server supplies reply wording and facts | The mark state comes from client signals only, and the dock chip is static presentation copy, not model output. `renderResponse` gains only the mark trigger |
| 0106 | A cold restore re-keys held ids and never re-mints them; no id is held by the mark | The mark state is a module variable, reset to `idle` on load. It holds no id and writes nothing to storage |
| 0106 | Quota or guard failure preserves conventional workflows | The `resting` state is decoration on `quota_refusal` and `CONCIERGE_UNAVAILABLE`. It changes no workflow, command or message text |
| 0106 | Guard diagnostics record only closed codes and counts | No diagnostic added by this change (the `assistant.control.outcome.v1` path is unchanged) |

**Decisions and deviations:**

- **(a) Working maps to thinking.** No tool-step signal reaches the client, so `working` is never produced. `nextAgentMarkState` treats it as `thinking` for the turn-ended path and keeps the type in place for the slice that adds a step signal.
- **(b) The human state is defined and CSS-tested, but unwired.** No takeover signal reaches guests (grep of `apps/local-guest/src` finds only payment handoff). Wiring is owed to whichever issue brings takeover to guests (ADR 0076). `nextAgentMarkState` keeps `human` absorbing so a later signal cannot leave it.
- **(c) `quota_refusal` does not reach the client as a code today.** It is recorded as a control outcome in `assistant-runtime.ts` (lines around 1094 and 1446) and the guest gets an ok response with the unavailable copy. The client branch for `quota_refusal` is therefore not reachable in practice, and only `CONCIERGE_UNAVAILABLE` gives `resting`. I did not re-trace this to the response body in this pass.
- **(d) The app-bar mark takes `view-transition-name` only once the empty state is hidden.** Duplicate names in one snapshot abort the view transition, so a shared name on both marks at once is not safe. The rule is `.app:has(#empty-state[hidden]) .ui-appbar > .agent-mark[data-agent-mark="appbar"]`. This deviates from "both share the name", and the deviation is deliberate.
- **(e) SETTLED by the owner (9 Nov 2026, in chat): the presence dock stays hidden while a workspace is open.** No grid row and no shell grid or snapshot change. This removes the decision from the open items. The rule has no media query, so it applies at every width; whether phones should differ is item (l).
- **(f) An extra `person` icon** was added to the kit for the human badge. It is an `ui-kit.ts` icon, not copy.
- **(g) The stays-mark icon replaced `home` in `persona.icon`.** `test/agent-mode-shell.test.ts` (one line) and the shell snapshot fixture `test/fixtures/guest-shell-pre-agent-modes.html` were updated for the added marks only.
- **(h) No new guest copy.** The "Concierge · Stays" wording is owed to issue 02 and the owner.
- **(i) The hero-to-app-bar view transition is not covered by an automated test.** The reply path submits through the real composer, so `withAgentMarkTransition` ran in the captured Chrome whenever `document.startViewTransition` exists there. The captures did not record a transition frame and nothing asserts the transition. **Not verified.**
- **(j) The held-turn fixture fix** (commit `00be181`). The hold keyed on `structuredOutput === undefined`, but the planner's reply plan is structured, so a search turn was never held. The hold now keys on the turn's first step and skips the scope classifier (`concierge_scope`). `test/helpers/agent-mark-fixture.ts` documents it.
- **(k) The dock copy duplicates the working copy beside it (new finding).** During a turn the dock chip and `#working-status` both show "Working on your request… Your stay details will stay here." (visible in `flight-light-390.png`). `#working-status` is the accessible signal and must stay. **Owner decision:** keep the duplicate, drop the chip text, or change the chip to a step name once a step signal exists.
- **(l) The dock is hidden whenever a workspace is open, at every width (new finding).** The CSS rule `main:has(#active-workspace:not([hidden])) > #agent-dock { display: none }` has no media query, so on a phone with a workspace open the in-flight dock is also hidden. The captures show this at 320, 390 and 768. The brief described the rule as desktop-only; the code does not scope it. **Owner decision:** whether the dock should show on phones with a workspace open.
- **Capture limitation.** The split captures set the in-flight state by writing the same attributes `setLoading` writes. The next client `setAgentMark` call overwrote the mark states, so those split shots show idle marks. The dock's hidden state is CSS-driven and is what the split captures test.

**Owner decisions outstanding:** (k), the duplicate working copy in the dock; (l), whether the dock should show on phones while a workspace is open. The 9 Nov decision in (e) keeps it hidden with a workspace open; the owner is asked to confirm that this also holds on phones. Also owed: the ADR 0107 wording on the labelled control (the mode sheet, slice 5). DoD item 7 is pending the batch gate.

**Map:** row 1b is set to `ready-for-human` in `map.md` for the same reason.
